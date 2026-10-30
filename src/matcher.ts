import { config } from "./config.js";
import { Listing } from "./types.js";

/** Проходит ли объявление фильтры config.ts. Применяется только при отборе для сводки/уведомлений — в data/state.json сохраняются все найденные объявления независимо от фильтра. */
export function passesFilters(l: Listing): boolean {
  return l.market === "primary" ? passesPrimary(l) : passesSecondary(l);
}

function passesPrimary(l: Listing): boolean {
  const c = config.primary;
  if (c.districts.length && l.district && !c.districts.includes(l.district)) return false;
  if (c.rooms.length && l.rooms !== null && !c.rooms.includes(l.rooms)) return false;
  if (l.areaM2 !== null) {
    if (c.areaFromM2 > 0 && l.areaM2 < c.areaFromM2) return false;
    if (c.areaToM2 !== null && l.areaM2 > c.areaToM2) return false;
  }
  if (c.priceTo > 0 && l.price > 0 && l.price > c.priceTo) return false;
  if (c.pricePerM2To > 0 && l.pricePerM2 !== null && l.pricePerM2 > c.pricePerM2To) return false;
  if (c.handoverBy && l.handoverDate && l.handoverDate > c.handoverBy) return false;
  if (c.housingClasses.length && l.housingClass && !c.housingClasses.includes(l.housingClass)) return false;
  return true;
}

function passesSecondary(l: Listing): boolean {
  const c = config.secondary;
  if (l.price > 0) {
    if (c.priceFrom > 0 && l.price < c.priceFrom) return false;
    if (c.priceTo > 0 && l.price > c.priceTo) return false;
  }
  if (c.rooms.length && l.rooms !== null && !c.rooms.includes(l.rooms)) return false;
  if (c.areaFromM2 > 0 && l.areaM2 !== null && l.areaM2 < c.areaFromM2) return false;
  if (c.districts.length && l.district && !c.districts.includes(l.district)) return false;

  const haystack = `${l.title} ${l.address || ""} ${l.description || ""}`.toLowerCase();
  for (const kw of c.excludeKeywords) {
    if (haystack.includes(kw.toLowerCase())) return false;
  }
  return true;
}
