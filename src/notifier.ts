import { config } from "./config.js";
import { Listing, Proposal, ListingStatus } from "./types.js";
import { sendText, sendImage } from "./whatsapp.js";
import { scoreListing, scoreLabel } from "./scorer.js";

const me = () => config.myWhatsApp;

/** Карточка нового подходящего объявления. */
export async function notifyNewListing(l: Listing, code: string): Promise<void> {
  const score = scoreListing(l);
  const lines = [
    `🏠 Новая квартира — ${scoreLabel(score)}`,
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

/** Уведомление об изменении цены на уже виденное объявление. */
export async function notifyPriceChange(l: Listing, oldPrice: number, code: string): Promise<void> {
  const diff = l.price - oldPrice;
  const direction = diff < 0 ? "снизилась 🟢" : "повысилась 🔴";
  const absDiff = Math.abs(diff).toLocaleString("ru-RU");
  const msg = [
    `💰 Цена ${direction} (код ${code})`,
    "",
    l.address ? `📍 ${l.address}` : null,
    `Было:   ${oldPrice.toLocaleString("ru-RU")} ₸`,
    `Стало:  ${l.price.toLocaleString("ru-RU")} ₸`,
    `Разница: ${diff < 0 ? "−" : "+"}${absDiff} ₸`,
    `🔗 ${l.url}`,
  ].filter(Boolean).join("\n");
  await sendText(me(), msg);
}

/** Ежедневная сводка всех найденных за день квартир. */
export async function sendDailyDigest(
  listings: (Listing & { code: string; status: ListingStatus })[]
): Promise<void> {
  const today = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

  if (listings.length === 0) {
    await sendText(me(), `📊 Итог дня — ${today}\n\nНовых подходящих квартир не найдено.`);
    return;
  }

  const sorted = [...listings].sort((a, b) => scoreListing(b) - scoreListing(a));

  const statusEmoji: Record<ListingStatus, string> = {
    new:        "",
    notified:   "",
    skipped:    "⏭ пропущено",
    contacting: "💬 переписка",
    confirmed:  "✅ встреча",
    declined:   "❌ отказ",
  };

  const lines: string[] = [
    `📊 Итог дня — ${today}`,
    `Найдено квартир: ${listings.length}`,
    "",
  ];

  sorted.forEach((l, i) => {
    const score = scoreListing(l);
    const status = statusEmoji[l.status] ? `  ${statusEmoji[l.status]}` : "";
    lines.push(`${i + 1}. ${scoreLabel(score)}${status}`);
    lines.push(`   💰 ${l.price ? l.price.toLocaleString("ru-RU") + " ₸" : "цена не указана"}${l.rooms ? ` · ${l.rooms}-комн` : ""}${l.areaM2 ? ` · ${l.areaM2} м²` : ""}`);
    if (l.address) lines.push(`   📍 ${l.address}`);
    lines.push(`   Код: ${l.code}  🔗 ${l.url}`);
    lines.push("");
  });

  // Разбиваем на части по 10 объявлений — Green API не принимает сообщения длиннее 20 000 символов
  const CHUNK = 10;
  const chunks: string[][] = [];
  const header = lines.slice(0, 3); // заголовок: "📊 Итог дня", пустая строка, пустая строка
  const items: string[] = lines.slice(3); // сами объявления

  for (let i = 0; i < items.length; i += CHUNK * 5) {
    chunks.push([...header, ...items.slice(i, i + CHUNK * 5)]);
  }
  if (chunks.length === 0) chunks.push(lines);

  const recipients = [me(), ...config.digestWhatsApp];
  for (const recipient of recipients) {
    for (let i = 0; i < chunks.length; i++) {
      const part = chunks.length > 1 ? [`📄 Часть ${i + 1} из ${chunks.length}`, "", ...chunks[i]] : chunks[i];
      await sendText(recipient, part.join("\n")).catch((e) =>
        console.error(`[digest] не удалось отправить на ${recipient}:`, (e as Error).message)
      );
    }
  }
}

export async function notifyUser(text: string): Promise<void> {
  await sendText(me(), text);
}
