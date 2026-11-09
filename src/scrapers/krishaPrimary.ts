import { chromium, Browser, ElementHandle } from "playwright";
import { config } from "../config.js";
import { Listing } from "../types.js";
import { sleep, randomDelay, assertPageNotBroken, matchFloat, pricePerM2, parseDistrict, parseKrishaPriceText } from "./util.js";

const SOURCE = "krishaPrimary";

/**
 * Разметка проверена вживую (Krisha.kz, раздел «Жилые комплексы», октябрь 2026).
 * Krisha периодически меняет вёрстку — если карточки перестали находиться,
 * открой https://krisha.kz/complex/search/?regionAlias=almaty в DevTools и поправь селекторы.
 * URL-фильтры (regionAlias, rooms[], priceTo, page) проверены вживую — ноябрь 2026.
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
  district: string | null;
  priceItems: { rooms: number | null; areaM2: number | null; price: number }[];
}

// Алиасы районов в фильтре Krisha (из window.data.search.store.regionAlias на странице поиска).
const DISTRICT_ALIASES: Record<string, string> = {
  Алатауский: "almaty-alatauskij",
  Алмалинский: "almaty-almalinskij",
  Ауэзовский: "almaty-aujezovskij",
  Бостандыкский: "almaty-bostandykskij",
  Жетысуский: "almaty-zhetysuskij",
  Медеуский: "almaty-medeuskij",
  Наурызбайский: "almaty-nauryzbajskiy",
  Турксибский: "almaty-turksibskij",
};

/** Фильтры config.primary передаются прямо в поиск Krisha, чтобы ограниченные maxPages страницы были релевантными. По району — отдельный поиск на каждый. */
function buildSearchTargets(): { url: string; district: string | null }[] {
  const params = new URLSearchParams();
  for (const r of new Set(config.primary.rooms.map((r) => Math.min(r, 4)))) params.append("rooms[]", String(r));
  if (config.primary.priceTo > 0) params.set("priceTo", String(config.primary.priceTo));

  const withRegion = (alias: string) => {
    const p = new URLSearchParams(params);
    p.set("regionAlias", alias);
    return `https://krisha.kz/complex/search/?${p.toString()}`;
  };

  if (config.primary.districts.length === 0) return [{ url: withRegion("almaty"), district: null }];

  const targets: { url: string; district: string | null }[] = [];
  for (const d of config.primary.districts) {
    const alias = DISTRICT_ALIASES[d];
    if (alias) targets.push({ url: withRegion(alias), district: d });
    else console.warn(`[${SOURCE}] неизвестный район "${d}" в config.primary.districts — пропускаю`);
  }
  return targets;
}

/** Собирает новостройки Алматы с Krisha.kz. Бросает ScraperError при подозрении на поломку вёрстки — ловит оркестратор (run.ts). */
export async function searchKrishaPrimary(): Promise<Listing[]> {
  const browser: Browser = await chromium.launch({ headless: config.scraper.headless });
  const context = await browser.newContext({ userAgent: config.scraper.userAgent });
  const page = await context.newPage();
  const cards: ComplexCard[] = [];
  const seenAliases = new Set<string>();

  try {
    for (const target of buildSearchTargets()) {
      for (let p = 1; p <= config.scraper.maxPages; p++) {
        // Без page=1: Krisha редиректит такой URL на канонический и теряет при этом rooms[].
        const url = p === 1 ? target.url : `${target.url}&page=${p}`;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await sleep(randomDelay());

        // По узкому фильтру (район + комнаты + бюджет) 0 ЖК — нормальный результат, поэтому поломку проверяем по сумме ниже.
        const cardEls = await page.$$(SELECTORS.card);
        if (cardEls.length === 0) break;

        for (const el of cardEls) {
          const parsed = await parseCard(el);
          if (!parsed || seenAliases.has(parsed.alias)) continue;
          seenAliases.add(parsed.alias);
          parsed.district = target.district ?? parseDistrict(parsed.address);
          cards.push(parsed);
        }
        if (cardEls.length < 12) break; // неполная страница — дальше результатов нет
      }
    }
  } finally {
    await browser.close();
  }

  assertPageNotBroken(SOURCE, 1, cards.length);

  // Детали (застройщик, срок сдачи, класс жилья, район) — отдельная страница на каждый ЖК.
  const detailBrowser = await chromium.launch({ headless: config.scraper.headless });
  const detailContext = await detailBrowser.newContext({ userAgent: config.scraper.userAgent });
  const detailPage = await detailContext.newPage();
  const results: Listing[] = [];

  try {
    for (const card of cards) {
      // Без опубликованных цен («Нет данных») объявлений из ЖК не получится — деталь не открываем, лишний раз не нагружаем сайт.
      if (card.priceItems.length === 0) continue;
      let developer: string | null = null;
      let handoverDate: string | null = null;
      let housingClass: string | null = null;
      const district = card.district;

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

    return { alias, name: name.trim(), address: address?.trim() || null, stateText, district: null, priceItems };
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
