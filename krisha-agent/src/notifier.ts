import { config } from "./config.js";
import { Listing, Proposal } from "./types.js";
import { sendText, sendImage } from "./whatsapp.js";

const me = () => config.myWhatsApp;

/** Карточка нового подходящего объявления. */
export async function notifyNewListing(l: Listing, code: string): Promise<void> {
  const lines = [
    "🏠 Новая квартира по твоим критериям",
    "",
    l.address ? `📍 ${l.address}` : null,
    `💰 ${l.price ? l.price.toLocaleString("ru-RU") + " ₸" : "цена не указана"}` +
      `${l.rooms ? ` · 🛏 ${l.rooms}-комн` : ""}` +
      `${l.areaM2 ? ` · 📐 ${l.areaM2} м²` : ""}`,
    `🔗 ${l.url}`,
    "",
    `Чтобы связаться с хозяином — ответь кодом: ${code}`,
    `Чтобы пропустить — ответь: пропустить`,
  ].filter(Boolean) as string[];

  await sendText(me(), lines.join("\n"));
  for (const photo of l.photos.slice(0, 1)) {
    await sendImage(me(), photo).catch(() => {});
  }
}

/** Черновик сообщения хозяину — на твоё одобрение перед отправкой. */
export async function sendDraftForApproval(
  code: string,
  draft: string,
  isOpener: boolean
): Promise<void> {
  const head = isOpener
    ? `✉️ Первое сообщение хозяину (код ${code}):`
    : `✉️ Черновик ответа хозяину (код ${code}):`;
  const msg = [
    head,
    "",
    `«${draft}»`,
    "",
    "Ответь:",
    "• ок — отправить",
    "• ред: <текст> — отправить свой вариант",
    "• нет — прекратить",
  ].join("\n");
  await sendText(me(), msg);
}

/** Запрос у тебя даты и времени для предложения хозяину. */
export async function askUserForDatetime(code: string, context?: string): Promise<void> {
  const msg = [
    context ? `📩 ${context}` : null,
    `Какие дату и время предложить хозяину для просмотра? (код ${code})`,
    "Напиши, например: «суббота 15:00» или «7 июня в 14:30».",
    "(или нет — прекратить)",
  ]
    .filter(Boolean)
    .join("\n");
  await sendText(me(), msg);
}

/** Финальное согласование времени и места — на твоё подтверждение. */
export async function sendFinalForApproval(code: string, p: Proposal): Promise<void> {
  const msg = [
    `📅 Хозяин готов на просмотр (код ${code}):`,
    "",
    `🗓 Дата: ${p.date}`,
    `⏰ Время: ${p.time}`,
    `📍 Место: ${p.place}`,
    p.notes ? `📝 ${p.notes}` : null,
    "",
    "Подтвердить встречу? Ответь:",
    "• да — подтвердить хозяину",
    "• нет — отменить",
  ]
    .filter(Boolean)
    .join("\n");
  await sendText(me(), msg);
}

export async function notifyUser(text: string): Promise<void> {
  await sendText(me(), text);
}
