import { config } from "./config.js";
import { Listing } from "./types.js";
import { isSeen } from "./db.js";

/** Только новые (не виденные) и подходящие под критерии объявления. */
export function filterNew(listings: Listing[]): Listing[] {
  return listings.filter((l) => !isSeen(l.id) && matchesCriteria(l));
}

export function matchesCriteria(l: Listing): boolean {
  if (l.price > 0 && (l.price < config.priceFrom || l.price > config.priceTo)) return false;
  if (config.rooms.length && l.rooms !== null && !config.rooms.includes(l.rooms)) return false;
  if (l.areaM2 !== null && l.areaM2 < config.areaFromM2) return false;

  const haystack = `${l.title} ${l.address || ""} ${l.description || ""}`.toLowerCase();
  for (const kw of config.excludeKeywords) {
    if (haystack.includes(kw.toLowerCase())) return false;
  }
  // Фильтр по району оставлен мягким: адрес на карточке не всегда содержит район.
  // При желании ужесточи здесь, если в выдаче появляются нерелевантные районы.
  return true;
}
