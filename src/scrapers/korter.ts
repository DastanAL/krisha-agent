import { chromium, Browser, Page } from "playwright";
import { config } from "../config.js";
import { Listing } from "../types.js";
import { sleep, randomDelay, ScraperError, pricePerM2 } from "./util.js";

const SOURCE = "korter";

/**
 * Korter.kz рендерит карточки через React с хешированными CSS-классами (нестабильны между сборками),
 * поэтому вместо селекторов читаем напрямую window.INITIAL_STATE — внутреннее состояние страницы,
 * которое сайт сам кладёт в window при серверном рендере. Проверено вживую октябрь 2026.
 * Если на странице исчез window.INITIAL_STATE.buildingListingStore.buildings — вёрстка/API изменились.
 */

interface KorterBuilding {
  buildingId: number;
  url: string;
  name: string;
  address: string | null;
  mainGeoObject?: { id: number; name: string };
  subLocalityNominative: string | null;
  minPrice: number | null;
  minPriceSqm: number | null;
  developers?: { name: string }[];
  constructionStatus: string | null;
}

interface KorterUnitType {
  roomCount: number | null;
  price?: { minPrice: number | null };
  area?: { minArea: number | null };
  minPriceSqm: number | null;
}

/** Собирает новостройки Алматы с Korter.kz. Бросает ScraperError при подозрении на поломку — ловит оркестратор (run.ts). */
export async function searchKorter(): Promise<Listing[]> {
  const browser: Browser = await chromium.launch({ headless: config.scraper.headless });
  const context = await browser.newContext({ userAgent: config.scraper.userAgent });
  const page = await context.newPage();
  const buildings: KorterBuilding[] = [];

  try {
    for (let p = 1; p <= config.scraper.maxPages; p++) {
      const sep = config.primary.korterCityUrl.includes("?") ? "&" : "?";
      const url = `${config.primary.korterCityUrl}${sep}page=${p}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await sleep(randomDelay());

      const pageBuildings = await readBuildingListingState(page, p);
      if (pageBuildings.length === 0) break;
      buildings.push(...pageBuildings.filter((b) => b.mainGeoObject?.name === "Алматы"));
    }
  } finally {
    await browser.close();
  }

  const detailBrowser = await chromium.launch({ headless: config.scraper.headless });
  const detailContext = await detailBrowser.newContext({ userAgent: config.scraper.userAgent });
  const results: Listing[] = [];

  try {
    for (const b of buildings) {
      const detailUrl = `https://korter.kz${b.url}`;
      let housingClass: string | null = null;
      let handoverDate: string | null = null;
      let unitTypes: KorterUnitType[] = [];

      // Отдельная страница на каждый ЖК (не переиспользуем одну) — Korter иногда сам инициирует
      // клиентскую навигацию (редиректы/префетч carousel "похожих ЖК"), что рвёт goto() на общей странице
      // ошибкой "interrupted by another navigation". Одна попытка retry на новой странице решает это.
      for (let attempt = 1; attempt <= 2; attempt++) {
        const dp = await detailContext.newPage();
        try {
          await dp.goto(detailUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
          await sleep(randomDelay());
          const landing = await readBuildingLandingState(dp);
          housingClass = landing.housingClass;
          handoverDate = landing.handoverDate;
          unitTypes = landing.unitTypes;
          break;
        } catch (e) {
          if (attempt === 2) console.warn(`[${SOURCE}] не удалось загрузить деталь ЖК ${b.url}:`, (e as Error).message);
        } finally {
          await dp.close().catch(() => {});
        }
      }

      const developer = b.developers?.[0]?.name || null;

      if (unitTypes.length === 0) {
        // Нет разбивки по комнатам — одна запись с минимальной ценой по комплексу.
        if (b.minPrice) {
          results.push(buildListing(b, detailUrl, developer, housingClass, handoverDate, null, null, b.minPrice));
        }
        continue;
      }

      for (const ut of unitTypes) {
        const price = ut.price?.minPrice || 0;
        if (price <= 0) continue;
        results.push(
          buildListing(b, detailUrl, developer, housingClass, handoverDate, ut.roomCount, ut.area?.minArea ?? null, price)
        );
      }
    }
  } finally {
    await detailBrowser.close();
  }

  return results;
}

function buildListing(
  b: KorterBuilding,
  url: string,
  developer: string | null,
  housingClass: string | null,
  handoverDate: string | null,
  rooms: number | null,
  areaM2: number | null,
  price: number
): Listing {
  return {
    id: "", // присваивается в src/dedup.ts
    market: "primary",
    source: "korter",
    title: b.name,
    url,
    price,
    pricePerM2: pricePerM2(price, areaM2) ?? b.minPriceSqm ?? null,
    rooms,
    areaM2,
    floor: null,
    district: b.subLocalityNominative,
    address: b.address,
    complexName: b.name,
    developer,
    handoverDate,
    housingClass,
    photos: [],
    description: null,
    postedAt: null,
  };
}

async function readBuildingListingState(page: Page, pageNum: number): Promise<KorterBuilding[]> {
  const buildings = await page.evaluate(() => {
    const state = (window as any).INITIAL_STATE;
    return state?.buildingListingStore?.buildings ?? null;
  });
  if (buildings === null) {
    throw new ScraperError(SOURCE, "window.INITIAL_STATE.buildingListingStore.buildings не найден — вероятно, изменилась страница листинга");
  }
  if (pageNum === 1 && buildings.length === 0) {
    throw new ScraperError(SOURCE, "на первой странице 0 ЖК — похоже, изменилась структура сайта или регион");
  }
  return buildings;
}

async function readBuildingLandingState(
  page: Page
): Promise<{ housingClass: string | null; handoverDate: string | null; unitTypes: KorterUnitType[] }> {
  return page.evaluate(() => {
    const state = (window as any).INITIAL_STATE;
    const landing = state?.buildingLandingStore;
    if (!landing) return { housingClass: null, handoverDate: null, unitTypes: [] };

    const classAttr = (landing.attributes?.house || []).find((a: any) => a.name === "Класс");
    const housingClass = classAttr?.value || null;

    const houses = landing.houses?.houses || [];
    let handoverDate: string | null = null;
    let maxEndYear = -1;
    for (const h of houses) {
      if (h.endYear && h.endYear > maxEndYear) {
        maxEndYear = h.endYear;
        handoverDate = h.endQuarter ? `${h.endQuarter} кв. ${h.endYear}` : `${h.endYear}`;
      }
    }

    const unitTypes = (landing.prices?.unitTypes || []).map((ut: any) => ({
      roomCount: ut.roomCount ?? null,
      price: ut.price,
      area: ut.area,
      minPriceSqm: ut.minPriceSqm ?? null,
    }));

    return { housingClass, handoverDate, unitTypes };
  });
}
