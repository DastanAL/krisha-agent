import "dotenv/config";
import { DealType } from "./types.js";

// ─────────── Соглашение по "пустым" значениям ───────────
// Числовое поле-максимум = 0 или null  →  без ограничения.
// Массив (районы/комнаты/классы жилья) = []  →  без ограничения по этому полю.
// Заполни TODO-поля под себя — до заполнения фильтры просто не ограничивают выборку.

export const config = {
  // ─────────── Первичка (новостройки) — приоритет ───────────
  primary: {
    enabled: true,
    districts: [] as string[], // TODO, напр. ["Бостандыкский", "Алмалинский"]
    rooms: [] as number[], // TODO, напр. [1, 2]
    areaFromM2: 0, // TODO
    areaToM2: null as number | null, // TODO
    priceTo: 0, // TODO, 0 = без лимита
    pricePerM2To: 0, // TODO, 0 = без лимита
    handoverBy: null as string | null, // TODO, формат "YYYY-MM", null = без ограничения
    housingClasses: [] as string[], // TODO, напр. ["комфорт", "бизнес"]
    krishaNewBuildingsUrl: "https://krisha.kz/complex/search/?regionAlias=almaty", // проверено вживую, отдаёт только ЖК Алматы
    korterCityUrl: "https://korter.kz/новостройки-алматы", // проверено вживую (из sitemap building_geo_city.xml)
  },

  // ─────────── Вторичка — выключена по умолчанию, второй этап ───────────
  secondary: {
    enabled: false,
    deal: "prodazha" as DealType,
    districts: [] as string[], // TODO
    priceFrom: 0, // TODO
    priceTo: 0, // TODO, 0 = без лимита
    rooms: [] as number[], // TODO
    areaFromM2: 0, // TODO
    excludeKeywords: [] as string[], // стоп-слова (при желании добавь)
    searchUrl: "https://krisha.kz/prodazha/kvartiry/almaty/", // TODO — выставь фильтры руками на krisha.kz и вставь итоговый URL
    districtScore: {} as Record<string, number>, // TODO — вес района для скоринга вторички (чем больше, тем выше в рейтинге)
  },

  // ─────────── Сводка и алерты ───────────
  digest: {
    priceDropAlertPct: 3, // немедленное сообщение при падении цены больше чем на столько %
    topDealsCount: 5,
  },

  // ─────────── Моя идентификация ───────────
  myName: "Дастан", // как агент представляется в сводке
  myWhatsApp: process.env.MY_WHATSAPP || "", // куда агент шлёт сводку и алерты (цифры с кодом страны, напр. 77001234567)
  digestWhatsApp: (process.env.DIGEST_WHATSAPP || "").split(",").map((n) => n.trim()).filter(Boolean), // доп. номера только для сводки

  // ─────────── Поведение парсера / безопасность ───────────
  scraper: {
    maxPages: 2,
    minDelayMs: 3000,
    maxDelayMs: 8000,
    headless: true,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  },

  // ─────────── Anthropic (сводка на русском) ───────────
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: "claude-sonnet-4-6",

  // ─────────── WhatsApp через Green API ───────────
  green: {
    idInstance: process.env.GREEN_API_ID_INSTANCE || "",
    apiToken: process.env.GREEN_API_TOKEN || "",
    apiUrl: process.env.GREEN_API_URL || "https://api.green-api.com",
  },
};
