import { chromium, Browser } from "playwright";
import { config } from "../config.js";
import { Listing } from "../types.js";
import { sleep, randomDelay, assertPageNotBroken, matchInt, matchFloat, pricePerM2, parseDistrict } from "./util.js";

const SOURCE = "krishaSecondary";

/**
 * ⚠️ СЕЛЕКТОРЫ НУЖНО ПРОВЕРИТЬ НА ЖИВОМ САЙТЕ.
 * Krisha периодически меняет вёрстку. Открой страницу поиска, в DevTools проверь
 * актуальные классы карточек и полей и при необходимости поправь здесь.
 */
const SELECTORS = {
  card: ".a-card",
  title: ".a-card__title",
  price: ".a-card__price",
  link: ".a-card__title a, a.a-card__title",
  subtitle: ".a-card__subtitle, .a-card__text-preview",
};

/** Собирает объявления вторичного рынка (покупка) с Krisha.kz. Бросает ScraperError при подозрении на поломку вёрстки — ловит оркестратор (run.ts). */
export async function searchKrishaSecondary(): Promise<Listing[]> {
  const browser: Browser = await chromium.launch({ headless: config.scraper.headless });
  const context = await browser.newContext({ userAgent: config.scraper.userAgent });
  const page = await context.newPage();
  const results: Listing[] = [];

  try {
    for (let p = 1; p <= config.scraper.maxPages; p++) {
      const sep = config.secondary.searchUrl.includes("?") ? "&" : "?";
      const url = `${config.secondary.searchUrl}${sep}page=${p}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await sleep(randomDelay()); // вежливая пауза, не нагружаем сайт

      const cards = await page.$$(SELECTORS.card);
      assertPageNotBroken(SOURCE, p, cards.length);
      if (cards.length === 0) break;

      for (const card of cards) {
        try {
          const id =
            (await card.getAttribute("data-id")) ||
            (await card.getAttribute("data-uuid")) ||
            "";
          const title = await safeText(card, SELECTORS.title);
          const href = await safeAttr(card, SELECTORS.link, "href");
          const priceText = await safeText(card, SELECTORS.price);
          const subtitle = await safeText(card, SELECTORS.subtitle);

          if (!id || !href) continue;

          const price = parseInt(priceText.replace(/\D/g, ""), 10) || 0;
          // Комнаты/площадь/этаж иногда в title, иногда в subtitle — Krisha меняет это между обновлениями вёрстки.
          const haystack = `${title} ${subtitle}`;
          const areaM2 = matchFloat(haystack, /(\d+[.,]?\d*)\s*м²/i);

          results.push({
            id: `krisha:${id}`,
            market: "secondary",
            source: "krisha",
            title,
            price,
            pricePerM2: pricePerM2(price, areaM2),
            rooms: matchInt(haystack, /(\d+)\s*-?\s*комн/i),
            areaM2,
            floor: matchFloor(haystack),
            district: parseDistrict(subtitle),
            address: subtitle.trim() || null,
            complexName: null,
            developer: null,
            handoverDate: null,
            housingClass: null,
            url: href.startsWith("http") ? href : `https://krisha.kz${href}`,
            photos: [],
            description: null,
            postedAt: null,
          });
        } catch {
          /* пропускаем битую карточку, остальное не трогаем */
        }
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}

async function safeText(card: any, sel: string): Promise<string> {
  try {
    return (await card.$eval(sel, (e: Element) => e.textContent?.trim() || "")) as string;
  } catch {
    return "";
  }
}
async function safeAttr(card: any, sel: string, attr: string): Promise<string> {
  try {
    return (await card.$eval(sel, (e: Element, a: string) => e.getAttribute(a) || "", attr)) as string;
  } catch {
    return "";
  }
}
function matchFloor(text: string): string | null {
  const m = text.match(/(\d+)\s*\/\s*(\d+)\s*эт/i);
  return m ? `${m[1]}/${m[2]}` : null;
}
