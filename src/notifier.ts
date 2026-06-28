import { config } from "./config.js";
import { Listing, Proposal, ListingStatus } from "./types.js";
import { sendText, sendImage } from "./whatsapp.js";
import { scoreListing, scoreLabel } from "./scorer.js";
import type { MonthlyStats } from "./db.js";

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

// Убирает мусорные параметры из URL krisha.kz, оставляет только чистую ссылку
function cleanUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

// Цену в миллионах: 27500000 → "27.5 млн ₸"
function fmtPrice(price: number): string {
  if (!price) return "цена не указана";
  const m = price / 1_000_000;
  return `${Number.isInteger(m) ? m : m.toFixed(1)} млн ₸`;
}

// Адрес — только первая значимая часть, до 45 символов
function shortAddr(address: string | null): string {
  if (!address) return "";
  const clean = address.split("—")[0].trim();
  return clean.length > 45 ? clean.slice(0, 42) + "…" : clean;
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

  const statusMark: Record<ListingStatus, string> = {
    new: "", notified: "", skipped: " ⏭", contacting: " 💬", confirmed: " ✅", declined: " ❌",
  };

  // Строим список объявлений — 3 строки на каждое
  const items: string[] = [];
  sorted.forEach((l, i) => {
    const score = scoreListing(l);
    const mark = statusMark[l.status] || "";
    const rooms = l.rooms ? `${l.rooms}к` : "";
    const area  = l.areaM2 ? `${l.areaM2}м²` : "";
    const spec  = [rooms, area].filter(Boolean).join(" · ");

    items.push(`${i + 1}. ${scoreLabel(score)}${mark}${spec ? `  ${spec}` : ""}`);
    items.push(`   💰 ${fmtPrice(l.price)}${l.address ? `  📍 ${shortAddr(l.address)}` : ""}`);
    items.push(`   ${cleanUrl(l.url)}  [${l.code}]`);
    items.push("");
  });

  // Разбиваем на части по ~4000 символов (лимит Green API — 20 000)
  const header = `📊 Итог дня — ${today} · ${listings.length} квартир\n\n`;
  const parts: string[] = [];
  let current = header;
  for (const line of items) {
    if ((current + line + "\n").length > 4000) {
      parts.push(current.trimEnd());
      current = header;
    }
    current += line + "\n";
  }
  if (current.trim() !== header.trim()) parts.push(current.trimEnd());

  const recipients = [me(), ...config.digestWhatsApp];
  for (const recipient of recipients) {
    for (let i = 0; i < parts.length; i++) {
      const prefix = parts.length > 1 ? `📄 ${i + 1}/${parts.length}\n` : "";
      await sendText(recipient, prefix + parts[i]).catch((e) =>
        console.error(`[digest] не удалось отправить на ${recipient}:`, (e as Error).message)
      );
    }
  }
}

export async function notifyUser(text: string): Promise<void> {
  await sendText(me(), text);
}

/** Ежемесячный отчёт — отправляется 1-го числа каждого месяца в 10:00. */
export async function sendMonthlyReport(stats: MonthlyStats): Promise<void> {
  const lines: string[] = [];

  lines.push(`📈 Статистика за ${stats.monthLabel}`);
  lines.push("");
  lines.push(`📋 Найдено квартир: ${stats.found}`);
  if (stats.found > 0) {
    const active = stats.found - stats.skipped - stats.contacting - stats.confirmed;
    lines.push(`   • Без ответа: ${active}`);
    if (stats.skipped)   lines.push(`   • Пропущено: ${stats.skipped}`);
    if (stats.contacting) lines.push(`   • Переговоры: ${stats.contacting}`);
    if (stats.confirmed)  lines.push(`   • Встречи: ${stats.confirmed}`);
  }

  if (stats.priceChanges.length === 0) {
    lines.push("");
    lines.push("💰 Изменений цен не было");
  } else {
    const down = stats.priceChanges.filter((c) => c.nowPrice < c.wasPrice);
    const up   = stats.priceChanges.filter((c) => c.nowPrice > c.wasPrice);

    lines.push("");
    lines.push(`💰 Изменения цен (${stats.priceChanges.length}):`);

    if (down.length > 0) {
      lines.push("");
      lines.push(`🟢 Снизились (${down.length}):`);
      for (const c of down) {
        const was = fmtPrice(c.wasPrice);
        const now = fmtPrice(c.nowPrice);
        const diff = fmtPrice(c.wasPrice - c.nowPrice);
        const district = c.district ? ` · ${c.district.replace(" район", "").replace("ский", "ск")}` : "";
        lines.push(`• [${c.code}]${district}: ${was} → ${now} (−${diff})`);
      }
    }

    if (up.length > 0) {
      lines.push("");
      lines.push(`🔴 Выросли (${up.length}):`);
      for (const c of up) {
        const was = fmtPrice(c.wasPrice);
        const now = fmtPrice(c.nowPrice);
        const diff = fmtPrice(c.nowPrice - c.wasPrice);
        const district = c.district ? ` · ${c.district.replace(" район", "").replace("ский", "ск")}` : "";
        lines.push(`• [${c.code}]${district}: ${was} → ${now} (+${diff})`);
      }
    }
  }

  const msg = lines.join("\n");
  const recipients = [me(), ...config.digestWhatsApp];
  for (const recipient of recipients) {
    await sendText(recipient, msg).catch((e) =>
      console.error(`[monthly] не удалось отправить на ${recipient}:`, (e as Error).message)
    );
  }
}
