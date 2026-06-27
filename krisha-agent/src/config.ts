import "dotenv/config";
import { DealType } from "./types.js";

export const config = {
  // ─────────── Критерии поиска ───────────
  deal: "prodazha" as DealType, // покупка
  city: "almaty",
  districts: [
    "Жетысуский",
    "Алмалинский",
    "Бостандыкский",
    "Ауэзовский",
    "Наурызбайский",
  ],
  priceFrom: 0, // ₸
  priceTo: 35_000_000, // ₸ (до 35 млн)
  rooms: [1, 2],
  areaFromM2: 35,
  excludeKeywords: [] as string[], // стоп-слова (при желании добавь)

  // URL поиска Krisha. 🔧 Рекомендуется: выставь фильтры руками на krisha.kz,
  // скопируй итоговый URL из адресной строки и вставь сюда целиком.
  searchUrl: "https://krisha.kz/prodazha/kvartiry/almaty/",

  // ─────────── Моя идентификация ───────────
  myName: "Дастан", // как агент представляется хозяину
  myWhatsApp: process.env.MY_WHATSAPP || "", // куда агент шлёт уведомления (цифры с кодом страны, напр. 77001234567)

  // ─────────── Расписание мониторинга ───────────
  checkIntervalCron: "*/20 * * * *", // каждые 20 минут

  // ─────────── Поведение парсера / безопасность ───────────
  scraper: {
    maxPages: 2,
    minDelayMs: 3000,
    maxDelayMs: 8000,
    headless: true,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  },

  // ─────────── Anthropic (диалог с хозяином) ───────────
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: "claude-sonnet-4-6",

  // ─────────── WhatsApp через Green API ───────────
  green: {
    idInstance: process.env.GREEN_API_ID_INSTANCE || "",
    apiToken: process.env.GREEN_API_TOKEN || "",
    apiUrl: process.env.GREEN_API_URL || "https://api.green-api.com",
    pollIntervalMs: 2000, // пауза между опросами при ошибке
  },
};

// Текст ПЕРВОГО сообщения хозяину. Содержит обязательное честное представление.
export function openerText(listingTitle: string): string {
  return (
    `Здравствуйте! Я — автоматический помощник, помогаю ${config.myName} с организацией ` +
    `просмотров квартир. Пишу по вашему объявлению на Krisha («${listingTitle}»). ` +
    `Подскажите, пожалуйста, оно ещё актуально?`
  );
}
