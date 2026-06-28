// Хранилище на простом JSON-файле — без нативных модулей и компиляции.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { Listing, ListingStatus, Negotiation, NegotiationPhase } from "./types.js";

const DATA_FILE = "krisha-agent-data.json";

interface PriceChange {
  oldPrice: number;
  newPrice: number;
  changedAt: string;
}

interface ListingRecord {
  id: string;
  code: string;
  title: string;
  price: number;
  rooms: number | null;
  areaM2: number | null;
  district: string | null;
  address: string | null;
  url: string;
  phone: string | null;
  postedAt: string | null;
  firstSeenAt: string;
  status: ListingStatus;
  priceHistory?: PriceChange[];
}

export interface PriceChangeEntry {
  code: string;
  district: string | null;
  wasPrice: number;
  nowPrice: number;
}

export interface MonthlyStats {
  monthLabel: string;
  found: number;
  skipped: number;
  contacting: number;
  confirmed: number;
  priceChanges: PriceChangeEntry[];
}

interface State {
  codeSeq: number;
  listings: Record<string, ListingRecord>;
  negotiations: Record<string, Negotiation>;
}

function load(): State {
  if (existsSync(DATA_FILE)) {
    try {
      return JSON.parse(readFileSync(DATA_FILE, "utf8"));
    } catch {
      // битый файл — начнём заново
    }
  }
  return { codeSeq: 1000, listings: {}, negotiations: {} };
}

const state: State = load();

function save(): void {
  writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
}

export function isSeen(id: string): boolean {
  return !!state.listings[id];
}

function nextCode(): string {
  state.codeSeq += 1;
  return String(state.codeSeq);
}

export function saveListing(l: Listing, status: ListingStatus): string {
  const existing = state.listings[l.id];
  const code = existing ? existing.code : nextCode();
  state.listings[l.id] = {
    id: l.id,
    code,
    title: l.title,
    price: l.price,
    rooms: l.rooms,
    areaM2: l.areaM2,
    district: l.district,
    address: l.address,
    url: l.url,
    phone: l.phone,
    postedAt: l.postedAt,
    firstSeenAt: existing ? existing.firstSeenAt : new Date().toISOString(),
    status,
    priceHistory: existing?.priceHistory,
  };
  save();
  return code;
}

export function setStatus(id: string, status: ListingStatus): void {
  const rec = state.listings[id];
  if (rec) {
    rec.status = status;
    save();
  }
}

function toListing(r: ListingRecord): Listing & { code: string; status: ListingStatus } {
  return {
    id: r.id,
    code: r.code,
    status: r.status,
    title: r.title,
    price: r.price,
    rooms: r.rooms,
    areaM2: r.areaM2,
    floor: null,
    district: r.district,
    address: r.address,
    url: r.url,
    phone: r.phone,
    photos: [],
    description: null,
    postedAt: r.postedAt,
  };
}

export function getListingByCode(code: string) {
  const rec = Object.values(state.listings).find((r) => r.code === code.trim());
  return rec ? toListing(rec) : null;
}

export function getListing(id: string) {
  const rec = state.listings[id];
  return rec ? toListing(rec) : null;
}

export function saveNegotiation(n: Negotiation): void {
  state.negotiations[n.listingId] = { ...n, updatedAt: new Date().toISOString() };
  save();
}

export function getNegotiation(listingId: string): Negotiation | null {
  return state.negotiations[listingId] || null;
}

const USER_PHASES: NegotiationPhase[] = [
  "awaiting_user_approval",
  "awaiting_user_datetime",
  "awaiting_user_final",
];

export function getNegotiationAwaitingUser(): Negotiation | null {
  const list = Object.values(state.negotiations)
    .filter((n) => USER_PHASES.includes(n.phase))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  return list[0] || null;
}

export function hasActiveNegotiation(): boolean {
  return Object.values(state.negotiations).some(
    (n) => n.phase !== "confirmed" && n.phase !== "declined"
  );
}

/** Все объявления, найденные сегодня. */
export function getListingsFoundToday(): (Listing & { code: string; status: ListingStatus })[] {
  const today = new Date().toISOString().slice(0, 10); // "2026-06-24"
  return Object.values(state.listings)
    .filter((r) => r.firstSeenAt.startsWith(today))
    .map(toListing);
}

/** Если цена изменилась — обновляет её в базе, сохраняет историю и возвращает старую. Иначе null. */
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

const MONTH_NAMES = [
  "январь","февраль","март","апрель","май","июнь",
  "июль","август","сентябрь","октябрь","ноябрь","декабрь",
];

/** Статистика за конкретный месяц (month: 1-12). */
export function getMonthlyStats(year: number, month: number): MonthlyStats {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  let found = 0, skipped = 0, contacting = 0, confirmed = 0;

  for (const rec of Object.values(state.listings)) {
    if (!rec.firstSeenAt.startsWith(prefix)) continue;
    found++;
    if (rec.status === "skipped") skipped++;
    else if (rec.status === "contacting") contacting++;
    else if (rec.status === "confirmed") confirmed++;
  }

  const priceChanges: PriceChangeEntry[] = [];
  for (const rec of Object.values(state.listings)) {
    if (!rec.priceHistory) continue;
    const monthChanges = rec.priceHistory.filter((c) => c.changedAt.startsWith(prefix));
    if (monthChanges.length === 0) continue;
    priceChanges.push({
      code: rec.code,
      district: rec.district,
      wasPrice: monthChanges[0].oldPrice,
      nowPrice: monthChanges[monthChanges.length - 1].newPrice,
    });
  }

  return {
    monthLabel: `${MONTH_NAMES[month - 1]} ${year}`,
    found,
    skipped,
    contacting,
    confirmed,
    priceChanges,
  };
}

export function getNegotiationByOwnerPhone(phone: string): Negotiation | null {
  const list = Object.values(state.negotiations)
    .filter((n) => n.ownerPhone === phone && n.phase === "awaiting_owner_reply")
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  return list[0] || null;
}
