import { Listing } from "./types.js";

function normalizeComplexName(name: string | null): string {
  return (name || "")
    .trim()
    .toLowerCase()
    .replace(/[«»"']/g, "")
    .replace(/^жк\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(text: string): string {
  return text
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "complex";
}

/** Детерминированный id объекта первички — не зависит от источника, стабилен между запусками. */
export function primaryListingId(normalizedName: string, rooms: number | null, areaM2: number | null): string {
  const roomsPart = rooms ?? "x";
  const areaPart = areaM2 !== null ? Math.round(areaM2) : "x";
  return `primary:${slug(normalizedName)}:${roomsPart}r:${areaPart}m2`;
}

/**
 * Склеивает объявления первички с разных площадок в одно: ЖК + комнаты + площадь (±1 м²).
 * Оставляет минимальную цену и объединение всех ссылок/источников.
 */
export function mergePrimaryListings(raw: Listing[]): Listing[] {
  interface Group {
    members: Listing[];
    normalizedName: string;
    rooms: number | null;
  }

  const areasMatch = (a: number | null, b: number | null): boolean =>
    a === null || b === null || Math.abs(a - b) <= 1;

  const groups: Group[] = [];

  for (const l of raw) {
    const normalizedName = normalizeComplexName(l.complexName);
    let group = groups.find(
      (g) =>
        g.normalizedName === normalizedName &&
        g.rooms === l.rooms &&
        g.members.some((m) => areasMatch(m.areaM2, l.areaM2))
    );
    if (!group) {
      group = { members: [], normalizedName, rooms: l.rooms };
      groups.push(group);
    }
    group.members.push(l);
  }

  return groups.map((g) => {
    const cheapest = [...g.members].sort((a, b) => a.price - b.price)[0];
    const sources = Array.from(new Set(g.members.map((m) => m.source)));
    const urls = Array.from(new Set(g.members.map((m) => m.url)));
    const pick = <K extends keyof Listing>(key: K): Listing[K] => {
      const withCheapestFirst = [cheapest, ...g.members.filter((m) => m !== cheapest)];
      for (const m of withCheapestFirst) {
        if (m[key] !== null && m[key] !== undefined && m[key] !== "") return m[key];
      }
      return cheapest[key];
    };

    const merged: Listing = {
      ...cheapest,
      id: primaryListingId(g.normalizedName, g.rooms, cheapest.areaM2),
      price: cheapest.price,
      source: cheapest.source,
      sources: sources.length > 1 ? sources : undefined,
      urls: urls.length > 1 ? urls : undefined,
      district: pick("district"),
      address: pick("address"),
      developer: pick("developer"),
      handoverDate: pick("handoverDate"),
      housingClass: pick("housingClass"),
      areaM2: cheapest.areaM2 ?? pick("areaM2"),
    };
    merged.pricePerM2 = merged.price && merged.areaM2 ? Math.round(merged.price / merged.areaM2) : null;
    return merged;
  });
}
