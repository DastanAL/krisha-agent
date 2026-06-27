import { openerText, config } from "./config.js";
import { Negotiation, ChatMessage } from "./types.js";
import { getListing, saveNegotiation, setStatus, hasActiveNegotiation } from "./db.js";
import { fetchOwnerPhone } from "./scraper.js";
import { draftNextMessage } from "./llm.js";
import { sendText } from "./whatsapp.js";
import {
  sendDraftForApproval,
  sendFinalForApproval,
  askUserForDatetime,
  notifyUser,
} from "./notifier.js";

const now = () => new Date().toISOString();
const msg = (role: ChatMessage["role"], content: string): ChatMessage => ({ role, content, at: now() });
const CLOSING = "Отлично, договорились! Спасибо, до встречи.";

/** Шаг 1: ты прислал код объявления → готовим первое сообщение хозяину на одобрение. */
export async function startContact(listingId: string): Promise<void> {
  const listing = getListing(listingId);
  if (!listing) return;

  if (hasActiveNegotiation()) {
    await notifyUser("⏳ Сейчас уже идёт переписка по другой квартире. Заверши её, прежде чем начинать новую.");
    return;
  }

  await notifyUser(`🔎 Ищу контакт хозяина по объявлению ${listing.code}…`);
  const phone = await fetchOwnerPhone(listing.url);
  if (!phone) {
    await notifyUser(`📵 Не удалось получить телефон хозяина автоматически. Свяжись вручную: ${listing.url}`);
    return;
  }

  const draft = openerText(listing.title);
  const neg: Negotiation = {
    listingId,
    ownerPhone: phone,
    phase: "awaiting_user_approval",
    pendingDraft: draft,
    proposal: null,
    history: [],
    updatedAt: now(),
  };
  saveNegotiation(neg);
  setStatus(listingId, "contacting");
  await sendDraftForApproval(listing.code, draft, /* isOpener */ true);
}

/** Ты ответил «ок» → отправляем хозяину. */
export async function approveAndSend(neg: Negotiation): Promise<void> {
  const listing = getListing(neg.listingId);
  if (!listing || !neg.pendingDraft) return;
  try {
    await sendText(neg.ownerPhone, neg.pendingDraft);
  } catch (e) {
    await notifyUser(`⚠️ Не удалось отправить сообщение хозяину (${(e as Error).message}). Ссылка: ${listing.url}`);
    return;
  }
  neg.history.push(msg("assistant", neg.pendingDraft));
  neg.pendingDraft = null;
  neg.phase = "awaiting_owner_reply";
  saveNegotiation(neg);
  await notifyUser("✅ Отправлено хозяину. Жду ответа.");
}

/** Ты ответил «ред: <текст>» → отправляем твой вариант. */
export async function editAndSend(neg: Negotiation, customText: string): Promise<void> {
  const listing = getListing(neg.listingId);
  if (!listing) return;
  try {
    await sendText(neg.ownerPhone, customText);
  } catch (e) {
    await notifyUser(`⚠️ Не удалось отправить (${(e as Error).message}). Ссылка: ${listing.url}`);
    return;
  }
  neg.history.push(msg("assistant", customText));
  neg.pendingDraft = null;
  neg.phase = "awaiting_owner_reply";
  saveNegotiation(neg);
  await notifyUser("✅ Твой вариант отправлен хозяину. Жду ответа.");
}

/** Ты ответил «нет» → прекращаем переписку. */
export async function declineDraft(neg: Negotiation): Promise<void> {
  neg.phase = "declined";
  neg.pendingDraft = null;
  saveNegotiation(neg);
  setStatus(neg.listingId, "declined");
  await notifyUser("🛑 Хорошо, прекращаю переписку по этой квартире.");
}

/** Пришёл ответ хозяина → решаем, что делать дальше. */
export async function handleOwnerReply(neg: Negotiation, ownerText: string): Promise<void> {
  const listing = getListing(neg.listingId);
  if (!listing) return;

  neg.history.push(msg("user", ownerText));

  let draft;
  try {
    draft = await draftNextMessage(listing, neg.history);
  } catch (e) {
    saveNegotiation(neg);
    await notifyUser(
      `⚠️ Не удалось обработать ответ хозяина (${(e as Error).message}).\nОн написал: «${ownerText}». Ответь вручную: ${listing.url}`
    );
    return;
  }

  if (draft.kind === "ask_datetime") {
    // Агент сам время не придумывает — спрашиваем у тебя.
    neg.phase = "awaiting_user_datetime";
    saveNegotiation(neg);
    await askUserForDatetime(listing.code, `Хозяин (код ${listing.code}) ответил: «${ownerText}».`);
  } else if (draft.kind === "proposal") {
    neg.proposal = draft.proposal;
    neg.pendingDraft = CLOSING;
    neg.phase = "awaiting_user_final";
    saveNegotiation(neg);
    await sendFinalForApproval(listing.code, draft.proposal);
  } else {
    neg.pendingDraft = draft.text;
    neg.phase = "awaiting_user_approval";
    saveNegotiation(neg);
    await sendDraftForApproval(listing.code, draft.text, /* isOpener */ false);
  }
}

/** Ты прислал дату/время → агент формулирует предложение хозяину тебе на одобрение. */
export async function provideDatetime(neg: Negotiation, datetimeText: string): Promise<void> {
  const listing = getListing(neg.listingId);
  if (!listing) return;

  const instruction =
    `СЕЙЧАС: ${config.myName} выбрал дату и время для просмотра: «${datetimeText}». ` +
    `Напиши хозяину обычное сообщение: предложи это время, попроси подтвердить и уточнить точный адрес и как найти подъезд/квартиру. Не возвращай JSON.`;

  let draft;
  try {
    draft = await draftNextMessage(listing, neg.history, instruction);
  } catch (e) {
    await notifyUser(`⚠️ Не удалось сформулировать сообщение (${(e as Error).message}). Попробуй ещё раз указать дату и время.`);
    return;
  }

  if (draft.kind === "proposal") {
    neg.proposal = draft.proposal;
    neg.pendingDraft = CLOSING;
    neg.phase = "awaiting_user_final";
    saveNegotiation(neg);
    await sendFinalForApproval(listing.code, draft.proposal);
  } else if (draft.kind === "ask_datetime") {
    neg.phase = "awaiting_user_datetime";
    saveNegotiation(neg);
    await askUserForDatetime(listing.code, "Уточни, пожалуйста, дату и время для предложения хозяину.");
  } else {
    neg.pendingDraft = draft.text;
    neg.phase = "awaiting_user_approval";
    saveNegotiation(neg);
    await sendDraftForApproval(listing.code, draft.text, /* isOpener */ false);
  }
}

/** Ты ответил «да» на финал → подтверждаем хозяину и закрываем. */
export async function confirmFinal(neg: Negotiation): Promise<void> {
  const listing = getListing(neg.listingId);
  if (!listing) return;
  const closing = neg.pendingDraft || CLOSING;
  try {
    await sendText(neg.ownerPhone, closing);
    neg.history.push(msg("assistant", closing));
  } catch (e) {
    await notifyUser(`⚠️ Не удалось отправить подтверждение хозяину (${(e as Error).message}).`);
  }
  neg.phase = "confirmed";
  neg.pendingDraft = null;
  saveNegotiation(neg);
  setStatus(neg.listingId, "confirmed");

  const p = neg.proposal;
  await notifyUser(
    `🎉 Встреча подтверждена!\n\n🏠 ${listing.title}\n` +
      (p ? `🗓 ${p.date} ⏰ ${p.time}\n📍 ${p.place}\n` : "") +
      `🔗 ${listing.url}\n\nДобавь её в календарь, чтобы не забыть.`
  );
}

/** Ты ответил «нет» на финал → отмена. */
export async function declineFinal(neg: Negotiation): Promise<void> {
  neg.phase = "declined";
  neg.pendingDraft = null;
  saveNegotiation(neg);
  setStatus(neg.listingId, "declined");
  await notifyUser("❌ Встреча не подтверждена. Хозяину подтверждение не отправлено.");
}
