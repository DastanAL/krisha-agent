import { chromium, Browser } from "playwright";
import { config } from "./config.js";
import { Listing } from "./types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randomDelay = () =>
  config.scraper.minDelayMs +
  Math.random() * (config.scraper.maxDelayMs - config.scraper.minDelayMs);

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

export async function searchListings(): Promise<Listing[]> {
  const browser: Browser = await chromium.launch({ headless: config.scraper.headless });
  const context = await browser.newContext({ userAgent: config.scraper.userAgent });
  const page = await context.newPage();
  const results: Listing[] = [];

  try {
    for (let p = 1; p <= config.scraper.maxPages; p++) {
      const sep = config.searchUrl.includes("?") ? "&" : "?";
      const url = `${config.searchUrl}${sep}page=${p}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await sleep(randomDelay()); // вежливая пауза, не нагружаем сайт

      const cards = await page.$$(SELECTORS.card);
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

          results.push({
            id,
            title,
            price: parseInt(priceText.replace(/\D/g, ""), 10) || 0,
            rooms: matchInt(subtitle, /(\d+)\s*-?\s*комн/i),
            areaM2: matchFloat(subtitle, /(\d+[.,]?\d*)\s*м²/i),
            floor: null,
            district: null,
            address: subtitle.trim() || null,
            url: href.startsWith("http") ? href : `https://krisha.kz${href}`,
            phone: null,
            photos: [],
            description: null,
            postedAt: null,
          });
        } catch {
          /* пропускаем битую карточку */
        }
      }
    }
  } catch (e) {
    // Блокировка/капча/таймаут — не долбим, просто выходим и попробуем в следующий цикл.
    console.warn("[scraper] ошибка обхода:", (e as Error).message);
  } finally {
    await browser.close();
  }
  return results;
}

/**
 * Дотягивает телефон хозяина со страницы конкретного объявления.
 * На Krisha телефон часто скрыт за кнопкой «Показать телефон» — поправь селекторы под факт.
 */
export async function fetchOwnerPhone(listingUrl: string): Promise<string | null> {
  const browser = await chromium.launch({ headless: config.scraper.headless });
  const context = await browser.newContext({ userAgent: config.scraper.userAgent });
  const page = await context.newPage();
  try {
    await page.goto(listingUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await sleep(randomDelay());
    const btn = await page.$(".show-phones, button.a-phones__button");
    if (btn) {
      await btn.click().catch(() => {});
      await sleep(1500);
    }
    const phoneEl = await page.$(".offer__contacts-phone, .a-phones__list");
    const raw = phoneEl ? (await phoneEl.textContent()) || "" : "";
    const digits = raw.replace(/\D/g, "");
    return digits.length >= 10 ? normalizeKzPhone(digits) : null;
  } catch {
    return null;
  } finally {
    await browser.close();
  }
}

function normalizeKzPhone(digits: string): string {
  // 8XXXXXXXXXX -> 7XXXXXXXXXX, оставляем формат без "+"
  if (digits.length === 11 && digits.startsWith("8")) return "7" + digits.slice(1);
  if (digits.length === 10) return "7" + digits;
  return digits;
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
function matchInt(text: string, re: RegExp): number | null {
  const m = text.match(re);
  return m ? parseInt(m[1], 10) : null;
}
function matchFloat(text: string, re: RegExp): number | null {
  const m = text.match(re);
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}
