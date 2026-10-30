// Единственная точка входа. Один запуск = один полный цикл: сбор → анализ → уведомление → сохранение.
// Расписание задаёт GitHub Actions (.github/workflows/scrape.yml) — здесь никакого cron/polling.
import { writeFileSync, mkdirSync } from "node:fs";
import { config } from "./config.js";
import { Listing } from "./types.js";
import { searchKrishaPrimary } from "./scrapers/krishaPrimary.js";
import { searchKorter } from "./scrapers/korter.js";
import { searchKrishaSecondary } from "./scrapers/krishaSecondary.js";
import { mergePrimaryListings } from "./dedup.js";
import { upsertListing, checkPriceChange, finalize, ListingRecord } from "./db.js";
import { passesFilters } from "./matcher.js";
import { rankBestDeals } from "./rank.js";
import { buildDailyDigest, DigestInput } from "./digest.js";
import { sendDailyDigest, notifyPriceDropAlert, notifyOpsError } from "./notifier.js";

interface SourceResult {
  name: string;
  ok: boolean;
  listings: Listing[];
  error?: string;
}

async function runSource(name: string, fn: () => Promise<Listing[]>): Promise<SourceResult> {
  try {
    const listings = await fn();
    console.log(`[run] ${name}: собрано ${listings.length}`);
    return { name, ok: true, listings };
  } catch (e) {
    const error = (e as Error).message;
    console.error(`[run] ${name} упал:`, error);
    return { name, ok: false, listings: [], error };
  }
}

async function main(): Promise<void> {
  console.log(`🚀 krisha-agent запуск: ${new Date().toLocaleString("ru-RU")}`);

  const sourceResults: SourceResult[] = [];

  if (config.primary.enabled) {
    sourceResults.push(await runSource("krishaPrimary", searchKrishaPrimary));
    sourceResults.push(await runSource("korter", searchKorter));
  }
  if (config.secondary.enabled) {
    sourceResults.push(await runSource("krishaSecondary", searchKrishaSecondary));
  }

  const sourceFailures = sourceResults.filter((r) => !r.ok).map((r) => r.name);
  const allOk = sourceResults.filter((r) => r.ok);

  if (sourceResults.length > 0 && allOk.length === 0) {
    console.error("[run] все источники упали, останавливаемся без сохранения");
    await notifyOpsError(`Сегодняшний прогон не удался: все источники (${sourceFailures.join(", ")}) упали.`).catch(() => {});
    process.exitCode = 1;
    return;
  }

  // Первичка: собираем листинги krishaPrimary + korter и склеиваем дубли между площадками.
  const primaryRaw = allOk
    .filter((r) => r.name === "krishaPrimary" || r.name === "korter")
    .flatMap((r) => r.listings);
  const primaryMerged = mergePrimaryListings(primaryRaw);

  const secondaryRaw = allOk.filter((r) => r.name === "krishaSecondary").flatMap((r) => r.listings);

  const allListings: Listing[] = [...primaryMerged, ...secondaryRaw];

  const allRecords: ListingRecord[] = [];
  const newOnes: ListingRecord[] = [];
  const priceDrops: DigestInput["priceDrops"] = [];
  const bigDrops: DigestInput["priceDrops"] = [];

  for (const l of allListings) {
    const change = checkPriceChange(l.id, l.price);
    const { record, isNew } = upsertListing(l);
    allRecords.push(record);

    if (change && change.oldPrice > 0) {
      const pct = ((change.oldPrice - l.price) / change.oldPrice) * 100;
      if (pct > 0) {
        const entry = { listing: record, oldPrice: change.oldPrice, newPrice: l.price, pct };
        priceDrops.push(entry);
        if (pct > config.digest.priceDropAlertPct) bigDrops.push(entry);
      }
    }
    if (isNew && passesFilters(l)) newOnes.push(record);
  }

  // Алерты о резком падении цены — немедленно, без Claude (точные числа важнее тона).
  for (const d of bigDrops) {
    await notifyPriceDropAlert(d.listing, d.oldPrice, d.listing.code, d.pct).catch((e) =>
      console.error("[run] не удалось отправить алерт о цене:", (e as Error).message)
    );
  }

  const filtered = allRecords.filter(passesFilters);
  const topDeals = rankBestDeals(filtered, config.digest.topDealsCount);

  const digestInput: DigestInput = { topDeals, newOnes, priceDrops, sourceFailures };

  try {
    const digestText = await buildDailyDigest(digestInput);
    await sendDailyDigest(digestText);
  } catch (e) {
    console.error("[run] не удалось отправить дневную сводку:", (e as Error).message);
  }

  mkdirSync("data", { recursive: true });
  writeFileSync(
    "data/digest.json",
    JSON.stringify({ generatedAt: new Date().toISOString(), ...digestInput }, null, 2),
    "utf8"
  );
  finalize();

  console.log(
    `[run] готово: первичка ${primaryMerged.length}, вторичка ${secondaryRaw.length}, новых ${newOnes.length}, снижений цен ${priceDrops.length}`
  );
}

main().catch((e) => {
  console.error("Фатальная ошибка:", e);
  process.exitCode = 1;
});
