import { chromium, Browser, ElementHandle } from "playwright";
import { config } from "../config.js";
import { Listing } from "../types.js";
import { sleep, randomDelay, assertPageNotBroken, matchFloat, pricePerM2, parseDistrict, parseKrishaPriceText } from "./util.js";

const SOURCE = "krishaPrimary";

/**
 * Разметка проверена вживую (Krisha.kz, раздел «Жилые комплексы», октябрь 2026).
 * Krisha периодически меняет вёрстку — если карточки перестали находиться,
 * открой https://krisha.kz/complex/search/?regionAlias=almaty в DevTools и поправь селекторы.
 */
const SELECTORS = {
  card: ".complex-card",
  title: ".complex-card__title",
  address: ".complex-card__address",
  state: ".complex-card__state",
  priceItem: ".complex-card__price-item",
  priceItemFlatPrice: ".complex-flat-price",
  sidebarInfo: ".complex__sidebar-info",
  sidebarInfoTitle: ".complex__sidebar-info-title",
  sidebarInfoText: ".complex__sidebar-info-text",
  housingClassTitle: '[data-name="housingClass"]',
};

interface ComplexCard {
  alias: string;
  name: string;
  address: string | null;
  stateText: string;
  priceItems: { rooms: number | null; areaM2: number | null; price: number }[];
}

/** Собирает новостройки Алматы с Krisha.kz. Бросает ScraperError при подозрении на поломку вёрстки — ловит оркестратор (run.ts). */
export async function searchKrishaPrimary(): Promise<Listing[]> {
  const browser: Browser = await chromium.launch({ headless: config.scraper.headless });
  const context = await browser.newContext({ userAgent: config.scraper.userAgent });
  const page = await context.newPage();
  const cards: ComplexCard[] = [];

  try {
    for (let p = 1; p <= config.scraper.maxPages; p++) {
      const sep = config.primary.krishaNewBuildingsUrl.includes("?") ? "&" : "?";
      const url = `${config.primary.krishaNewBuildingsUrl}${sep}page=${p}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await sleep(randomDelay());

      const cardEls = await page.$$(SELECTORS.card);
      assertPageNotBroken(SOURCE, p, cardEls.length);
      if (cardEls.length === 0) break;

      for (const el of cardEls) {
        const parsed = await parseCard(el);
        if (parsed) cards.push(parsed);
      }
    }
  } finally {
    await browser.close();
  }

  // Детали (застройщик, срок сдачи, класс жилья, район) — отдельная страница на каждый ЖК.
  const detailBrowser = await chromium.launch({ headless: config.scraper.headless });
  const detailContext = await detailBrowser.newContext({ userAgent: config.scraper.userAgent });
  const detailPage = await detailContext.newPage();
  const results: Listing[] = [];

  try {
    for (const card of cards) {
      let developer: string | null = null;
      let handoverDate: string | null = null;
      let housingClass: string | null = null;
      let district: string | null = parseDistrict(card.address);

      try {
        await detailPage.goto(`https://krisha.kz/complex/show/${card.alias}/`, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await sleep(randomDelay());
        developer = await findSidebarInfo(detailPage, "Застройщик");
        handoverDate = await findSidebarInfo(detailPage, "Срок сдачи");
        housingClass = await findHousingClass(detailPage);
      } catch (e) {
        // Деталь не загрузилась — не прерываем остальных, просто без доп. полей.
        console.warn(`[${SOURCE}] не удалось загрузить деталь ЖК ${card.alias}:`, (e as Error).message);
      }

      const url = `https://krisha.kz/complex/show/${card.alias}/`;
      for (const item of card.priceItems) {
        results.push({
          id: "", // присваивается в src/dedup.ts
          market: "primary",
          source: "krisha",
          title: card.name,
          url,
          price: item.price,
          pricePerM2: pricePerM2(item.price, item.areaM2),
          rooms: item.rooms,
          areaM2: item.areaM2,
          floor: null,
          district,
          address: card.address,
          complexName: card.name,
          developer,
          handoverDate,
          housingClass,
          photos: [],
          description: null,
          postedAt: null,
        });
      }
    }
  } finally {
    await detailBrowser.close();
  }

  return results;
}

async function parseCard(el: ElementHandle): Promise<ComplexCard | null> {
  try {
    const alias = (await el.getAttribute("data-complex-alias")) || "";
    if (!alias) return null;
    const name = (await safeText(el, SELECTORS.title)) || (await el.getAttribute("data-name")) || "";
    const address = (await safeText(el, SELECTORS.address)) || null;
    const stateText = await safeText(el, SELECTORS.state);

    const priceItemEls = await el.$$(SELECTORS.priceItem);
    const priceItems: ComplexCard["priceItems"] = [];
    for (const itemEl of priceItemEls) {
      const fullText = ((await itemEl.textContent()) || "").trim();
      const priceText = await safeText(itemEl, SELECTORS.priceItemFlatPrice);
      const price = parseKrishaPriceText(priceText);
      const rooms = matchRooms(fullText);
      const areaM2 = matchFloat(fullText, /(\d+[.,]?\d*)\s*м²/i);
      if (price > 0) priceItems.push({ rooms, areaM2, price });
    }

    return { alias, name: name.trim(), address: address?.trim() || null, stateText, priceItems };
  } catch {
    return null;
  }
}

async function findSidebarInfo(page: any, titleText: string): Promise<string | null> {
  const blocks = await page.$$(SELECTORS.sidebarInfo);
  for (const block of blocks) {
    const title = await safeText(block, SELECTORS.sidebarInfoTitle);
    if (title.trim() === titleText) {
      return (await safeText(block, SELECTORS.sidebarInfoText)).trim() || null;
    }
  }
  return null;
}

async function findHousingClass(page: any): Promise<string | null> {
  try {
    const dt = await page.$(SELECTORS.housingClassTitle);
    if (!dt) return null;
    const dd = await dt.evaluateHandle((node: Element) => node.nextElementSibling);
    const text = await dd.evaluate((node: Element | null) => node?.textContent?.trim() || "");
    return text || null;
  } catch {
    return null;
  }
}

function matchRooms(text: string): number | null {
  const m = text.match(/(\d+)-комн/i);
  return m ? parseInt(m[1], 10) : null;
}

async function safeText(handle: any, sel: string): Promise<string> {
  try {
    return (await handle.$eval(sel, (e: Element) => e.textContent?.trim() || "")) as string;
  } catch {
    return "";
  }
}
