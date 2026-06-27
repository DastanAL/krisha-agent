import cron from "node-cron";
import { config } from "./config.js";
import { searchListings } from "./scraper.js";
import { filterNew } from "./matcher.js";
import { saveListing } from "./db.js";
import { notifyNewListing } from "./notifier.js";

/** Один цикл: поиск → отбор новых → уведомления тебе. */
export async function runPipeline(): Promise<void> {
  const listings = await searchListings();
  const fresh = filterNew(listings);
  for (const l of fresh) {
    const code = saveListing(l, "notified");
    try {
      await notifyNewListing(l, code);
    } catch (e) {
      console.error("[pipeline] не удалось отправить уведомление:", (e as Error).message);
    }
  }
  console.log(
    `[pipeline] ${new Date().toLocaleString("ru-RU")}: новых подходящих ${fresh.length} из ${listings.length}`
  );
}

export function startScheduler(): void {
  cron.schedule(config.checkIntervalCron, () => {
    runPipeline().catch((e) => console.error("[pipeline] ошибка:", e));
  });
  console.log(`[scheduler] мониторинг запущен по расписанию: ${config.checkIntervalCron}`);
}
