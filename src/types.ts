// Общие типы проекта

export type DealType = "arenda" | "prodazha";
export type Market = "primary" | "secondary";
export type Source = "krisha" | "korter";

export interface Listing {
  id: string; // детерминированный id — см. src/dedup.ts для первички, krisha:<nativeId> для вторички
  market: Market;
  source: Source; // источник с минимальной ценой, если объект слит из нескольких
  sources?: Source[]; // все источники, если объект слит из нескольких
  urls?: string[]; // объединение ссылок, если объект слит из нескольких
  title: string;
  url: string; // = urls[0], если объект слит из нескольких
  price: number; // в тенге, минимальная цена среди источников
  pricePerM2: number | null; // price / areaM2, если оба известны
  rooms: number | null;
  areaM2: number | null;
  floor: string | null; // только вторичка
  district: string | null;
  address: string | null;
  complexName: string | null; // ЖК — только первичка
  developer: string | null; // застройщик — только первичка
  handoverDate: string | null; // срок сдачи — только первичка
  housingClass: string | null; // класс жилья — только первичка
  photos: string[];
  description: string | null;
  postedAt: string | null;
}
