// Хранилище на простом JSON-файле — коммитится в репозиторий самим GitHub Actions workflow.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Listing } from "./types.js";

const DATA_FILE = "data/state.json";

interface PriceChange {
  oldPrice: number;
  newPrice: number;
  changedAt: string;
}

interface ListingRecord extends Listing {
  code: string;
  firstSeenAt: string;
  lastSeenAt: string;
  priceHistory?: PriceChange[];
}

interface State {
  version: 1;
  generatedAt: string | null;
  codeSeq: number;
  listings: Record<string, ListingRecord>;
}

function load(): State {
  if (existsSync(DATA_FILE)) {
    try {
      return JSON.parse(readFileSync(DATA_FILE, "utf8"));
    } catch {
      // битый файл — начнём заново
    }
  }
  return { version: 1, generatedAt: null, codeSeq: 1000, listings: {} };
}

const state: State = load();

function save(): void {
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
}

export function isSeen(id: string): boolean {
  return !!state.listings[id];
}

function nextCode(): string {
  state.codeSeq += 1;
  return String(state.codeSeq);
}

/** Для первички, если точного id нет — ищем похожую существующую запись (тот же ЖК+комнаты, площадь ±1 м²), чтобы не терять историю при дрейфе округления площади между запусками. */
function findFallbackRecord(l: Listing): ListingRecord | null {
  if (l.market !== "primary" || !l.complexName) return null;
  const normalized = l.complexName.trim().toLowerCase();
  for (const rec of Object.values(state.listings)) {
    if (rec.market !== "primary" || !rec.complexName) continue;
    if (rec.complexName.trim().toLowerCase() !== normalized) continue;
    if (rec.rooms !== l.rooms) continue;
    if (rec.areaM2 !== null && l.areaM2 !== null && Math.abs(rec.areaM2 - l.areaM2) <= 1) return rec;
  }
  return null;
}

/** Сохраняет/обновляет объявление. Сохраняются ВСЕ найденные объявления независимо от фильтров config.ts — фильтр применяется только при отборе для уведомлений. */
export function upsertListing(l: Listing): { record: ListingRecord; isNew: boolean } {
  const existing = state.listings[l.id] || findFallbackRecord(l);
  const now = new Date().toISOString();
  const code = existing ? existing.code : nextCode();

  const record: ListingRecord = {
    ...l,
    code,
    firstSeenAt: existing ? existing.firstSeenAt : now,
    lastSeenAt: now,
    priceHistory: existing?.priceHistory,
  };
  state.listings[l.id] = record;
  save();
  return { record, isNew: !existing };
}

export function getListing(id: string): ListingRecord | null {
  return state.listings[id] || null;
}

export function getListingByCode(code: string): ListingRecord | null {
  return Object.values(state.listings).find((r) => r.code === code.trim()) || null;
}

/** Все объявления, впервые увиденные за последние 24 часа. */
export function getListingsFoundLast24h(): ListingRecord[] {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return Object.values(state.listings).filter((r) => new Date(r.firstSeenAt).getTime() >= cutoff);
}

/** Если цена изменилась — обновляет её, сохраняет историю и возвращает старую цену. Иначе null. */
export function checkPriceChange(id: string, newPrice: number): { oldPrice: number } | null {
  const rec = state.listings[id];
  if (!rec || newPrice <= 0 || rec.price === newPrice) return null;
  const oldPrice = rec.price;
  if (!rec.priceHistory) rec.priceHistory = [];
  rec.priceHistory.push({ oldPrice, newPrice, changedAt: new Date().toISOString() });
  rec.price = newPrice;
  save();
  return { oldPrice };
}

/** Проставляет generatedAt и сохраняет. Вызывается один раз в конце run.ts. */
export function finalize(): void {
  state.generatedAt = new Date().toISOString();
  save();
}

export type { ListingRecord, PriceChange, State };
