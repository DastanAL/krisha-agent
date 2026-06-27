import cron from "node-cron";
import { config } from "./config.js";
import { searchListings } from "./scraper.js";
import { filterNew } from "./matcher.js";
import { saveListing, getListing, checkPriceChange, getListingsFoundToday } from "./db.js";
import { notifyNewListing, notifyPriceChange, sendDailyDigest } from "./notifier.js";
import { scoreListing } from "./scorer.js";

/** Один цикл: поиск → изменения цен → новые объявления → уведомления тебе. */
export async function runPipeline(): Promise<void> {
  const listings = await searchListings();

  // Проверяем изменения цен у уже известных объявлений
  for (const l of listings) {
    const change = checkPriceChange(l.id, l.price);
    if (change) {
      const saved = getListing(l.id);
      if (saved) {
        try {
          await notifyPriceChange(l, change.oldPrice, saved.code);
        } catch (e) {
          console.error("[pipeline] не удалось отправить уведомление о цене:", (e as Error).message);
        }
      }
    }
  }

  // Новые объявления — сортируем по скору, лучшие первыми
  const fresh = filterNew(listings).sort((a, b) => scoreListing(b) - scoreListing(a));
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

  // Ежедневная сводка в 18:00
  cron.schedule("0 18 * * *", () => {
    const listings = getListingsFoundToday();
    sendDailyDigest(listings).catch((e) => console.error("[digest] ошибка:", e));
  });

  console.log(`[scheduler] мониторинг запущен по расписанию: ${config.checkIntervalCron}`);
  console.log("[scheduler] ежедневная сводка — каждый день в 18:00");
}
