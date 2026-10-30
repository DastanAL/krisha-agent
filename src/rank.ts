import { Listing } from "./types.js";

/** Топ-N объявлений по цене за м² (меньше — лучше). Объявления без цены/площади исключаются. */
export function rankBestDeals<T extends Listing>(listings: T[], count: number): T[] {
  return listings
    .filter((l) => l.pricePerM2 !== null && l.pricePerM2 > 0)
    .sort((a, b) => (a.pricePerM2 as number) - (b.pricePerM2 as number))
    .slice(0, count);
}
