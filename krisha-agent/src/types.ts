// Общие типы проекта

export type DealType = "arenda" | "prodazha";

export interface Listing {
  id: string;
  title: string;
  price: number; // в тенге
  rooms: number | null;
  areaM2: number | null;
  floor: string | null;
  district: string | null;
  address: string | null;
  url: string;
  phone: string | null;
  photos: string[];
  description: string | null;
  postedAt: string | null;
}

export type ListingStatus =
  | "new"
  | "notified"
  | "skipped"
  | "contacting"
  | "confirmed"
  | "declined";

// Фаза переписки с хозяином (state machine)
export type NegotiationPhase =
  | "awaiting_user_approval" // черновик ждёт твоего ок/ред/нет
  | "awaiting_user_datetime" // агент ждёт от тебя дату/время для предложения хозяину
  | "awaiting_owner_reply" // сообщение отправлено хозяину, ждём его ответ
  | "awaiting_user_final" // согласован слот, ждём твоё финальное "да"
  | "confirmed"
  | "declined";

export interface Proposal {
  date: string;
  time: string;
  place: string;
  notes: string;
}

export interface ChatMessage {
  role: "assistant" | "user"; // user = хозяин в этом подразговоре
  content: string;
  at: string;
}

export interface Negotiation {
  listingId: string;
  ownerPhone: string;
  phase: NegotiationPhase;
  pendingDraft: string | null;
  proposal: Proposal | null;
  history: ChatMessage[]; // только реально отправленные/полученные сообщения
  updatedAt: string;
}

export interface IncomingMessage {
  from: string; // номер отправителя (только цифры)
  text: string;
  at: string;
}
