import { config } from "./config.js";
import { IncomingMessage } from "./types.js";
import { getListingByCode, getNegotiationAwaitingUser, getNegotiationByOwnerPhone } from "./db.js";
import {
  startContact,
  approveAndSend,
  editAndSend,
  declineDraft,
  provideDatetime,
  confirmFinal,
  declineFinal,
  handleOwnerReply,
} from "./negotiator.js";
import { notifyUser } from "./notifier.js";

const digits = (s: string) => s.replace(/\D/g, "");
const isYes = (s: string) => /^(ок|ok|да|yes|\+|подтверждаю)$/i.test(s);
const isNo = (s: string) => /^(нет|no|-|отмена|стоп)$/i.test(s);

export async function dispatch(incoming: IncomingMessage): Promise<void> {
  const from = digits(incoming.from);
  const text = incoming.text.trim();

  if (from === digits(config.myWhatsApp)) {
    await handleUserMessage(text);
  } else {
    await handleOwnerMessage(from, text);
  }
}

async function handleUserMessage(text: string): Promise<void> {
  // 1) Команда «связаться» по коду объявления.
  if (/^\d{3,6}$/.test(text)) {
    const listing = getListingByCode(text);
    if (!listing) return void (await notifyUser(`Не нашёл объявление с кодом ${text}.`));
    if (listing.status === "contacting") return void (await notifyUser(`По коду ${text} переписка уже идёт.`));
    if (listing.status === "confirmed" || listing.status === "declined")
      return void (await notifyUser(`По коду ${text} вопрос уже закрыт.`));
    await startContact(listing.id);
    return;
  }

  // 2) Реакция на активную переписку, ожидающую твоего ответа.
  const neg = getNegotiationAwaitingUser();
  if (neg) {
    if (neg.phase === "awaiting_user_approval") {
      if (isYes(text)) return void (await approveAndSend(neg));
      if (isNo(text)) return void (await declineDraft(neg));
      if (/^ред:/i.test(text)) {
        const custom = text.replace(/^ред:\s*/i, "").trim();
        if (custom) return void (await editAndSend(neg, custom));
      }
      await notifyUser("Не понял. Ответь: ок, нет или ред: <текст>.");
      return;
    }
    if (neg.phase === "awaiting_user_datetime") {
      if (isNo(text)) return void (await declineDraft(neg));
      // Любой другой текст считаем датой/временем для предложения хозяину.
      return void (await provideDatetime(neg, text));
    }
    if (neg.phase === "awaiting_user_final") {
      if (isYes(text)) return void (await confirmFinal(neg));
      if (isNo(text)) return void (await declineFinal(neg));
      await notifyUser("Подтвердить встречу? Ответь да или нет.");
      return;
    }
  }

  // 3) Прочее.
  if (/^пропустить$/i.test(text)) return void (await notifyUser("Ок, пропускаю."));
  await notifyUser(
    "Я слежу за квартирами и пишу, когда есть подходящие. Чтобы связаться с хозяином — пришли код объявления из уведомления."
  );
}

async function handleOwnerMessage(from: string, text: string): Promise<void> {
  const neg = getNegotiationByOwnerPhone(from);
  if (neg) await handleOwnerReply(neg, text);
  else console.log(`[owner] сообщение от ${from} вне активной переписки: ${text}`);
}
