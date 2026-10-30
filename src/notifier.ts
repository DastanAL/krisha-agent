import { config } from "./config.js";
import { Listing } from "./types.js";
import { sendText } from "./whatsapp.js";

const me = () => config.myWhatsApp;

function fmtPrice(price: number): string {
  if (!price) return "цена не указана";
  const m = price / 1_000_000;
  return `${Number.isInteger(m) ? m : m.toFixed(1)} млн ₸`;
}

function shortAddr(address: string | null): string {
  if (!address) return "";
  const clean = address.split("—")[0].trim();
  return clean.length > 45 ? clean.slice(0, 42) + "…" : clean;
}

function cleanUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

/** Немедленный алерт при падении цены больше чем на config.digest.priceDropAlertPct %. */
export async function notifyPriceDropAlert(l: Listing, oldPrice: number, code: string, pct: number): Promise<void> {
  const diff = oldPrice - l.price;
  const msg = [
    `🟢 Цена упала на ${pct.toFixed(1)}% (код ${code})`,
    "",
    l.complexName ? `🏢 ${l.complexName}` : l.title,
    l.address ? `📍 ${shortAddr(l.address)}` : null,
    `Было:   ${oldPrice.toLocaleString("ru-RU")} ₸`,
    `Стало:  ${l.price.toLocaleString("ru-RU")} ₸`,
    `Разница: −${diff.toLocaleString("ru-RU")} ₸`,
    `🔗 ${cleanUrl(l.url)}`,
  ]
    .filter(Boolean)
    .join("\n");
  await sendText(me(), msg);
}

/** Дневная сводка (текст уже сформирован в src/digest.ts). Разбивается на части ~4000 символов (лимит Green API — 20 000). */
export async function sendDailyDigest(text: string): Promise<void> {
  const parts: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if ((current + line + "\n").length > 4000) {
      parts.push(current.trimEnd());
      current = "";
    }
    current += line + "\n";
  }
  if (current.trim()) parts.push(current.trimEnd());

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

/** Сообщение о сбое запуска (например, если ни один источник не отработал). */
export async function notifyOpsError(text: string): Promise<void> {
  await sendText(me(), `⚠️ ${text}`);
}
