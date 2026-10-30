import { config } from "../config.js";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const randomDelay = () =>
  config.scraper.minDelayMs +
  Math.random() * (config.scraper.maxDelayMs - config.scraper.minDelayMs);

/** Ошибка скрейпера — бросается при подозрении на смену вёрстки или блокировку, ловится оркестратором (run.ts), не самим скрейпером. */
export class ScraperError extends Error {
  constructor(public source: string, message: string) {
    super(`[${source}] ${message}`);
    this.name = "ScraperError";
  }
}

/**
 * 0 карточек на первой странице — подозрение на смену вёрстки/блокировку, это ошибка.
 * 0 карточек на странице >1 — нормальный конец пагинации, не ошибка.
 */
export function assertPageNotBroken(source: string, page: number, cardCount: number): void {
  if (page === 1 && cardCount === 0) {
    throw new ScraperError(source, "на первой странице 0 карточек — похоже, изменилась вёрстка или сайт заблокировал запрос");
  }
}

export function matchInt(text: string, re: RegExp): number | null {
  const m = text.match(re);
  return m ? parseInt(m[1], 10) : null;
}

export function matchFloat(text: string, re: RegExp): number | null {
  const m = text.match(re);
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}

export function pricePerM2(price: number, areaM2: number | null): number | null {
  if (!price || !areaM2) return null;
  return Math.round(price / areaM2);
}

/** Вытаскивает "Бостандыкский" из "Алматы, Бостандыкский р-н, ул. ..." — общий для обоих рынков Krisha.kz. */
export function parseDistrict(address: string | null): string | null {
  if (!address) return null;
  const m = address.match(/([А-ЯӘӨҒҮҰҰІ][а-яәөғүұі]+ский)\s*р-н/i);
  return m ? m[1] : null;
}

/**
 * Krisha показывает цену по-разному в зависимости от ЖК: либо полным числом («от 37 125 000 ₸»),
 * либо сокращённо диапазоном в миллионах («30.7 – 31.1 млн ₸»). Берём минимальную (стартовую) цену диапазона.
 */
export function parseKrishaPriceText(text: string): number {
  const mlnMatch = text.match(/(\d+[.,]?\d*)\s*млн/i);
  if (mlnMatch) {
    return Math.round(parseFloat(mlnMatch[1].replace(",", ".")) * 1_000_000);
  }
  const tysMatch = text.match(/(\d+[.,]?\d*)\s*тыс/i);
  if (tysMatch) {
    return Math.round(parseFloat(tysMatch[1].replace(",", ".")) * 1_000);
  }
  return parseInt(text.replace(/\D/g, ""), 10) || 0;
}
