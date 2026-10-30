import { config } from "./config.js";
import { ListingRecord } from "./db.js";

export interface DigestInput {
  topDeals: ListingRecord[];
  newOnes: ListingRecord[];
  priceDrops: { listing: ListingRecord; oldPrice: number; newPrice: number; pct: number }[];
  sourceFailures: string[];
}

function fmtPrice(price: number): string {
  if (!price) return "цена не указана";
  const m = price / 1_000_000;
  return `${Number.isInteger(m) ? m : m.toFixed(1)} млн ₸`;
}

function listingLine(l: ListingRecord): string {
  const parts = [
    l.complexName ? `🏢 ${l.complexName}` : l.title,
    l.rooms ? `${l.rooms}-комн` : null,
    l.areaM2 ? `${l.areaM2} м²` : null,
    fmtPrice(l.price),
    l.pricePerM2 ? `${l.pricePerM2.toLocaleString("ru-RU")} ₸/м²` : null,
    l.district || null,
  ].filter(Boolean);
  return `[${l.code}] ${parts.join(" · ")} — ${l.url}`;
}

function buildFactsText(input: DigestInput): string {
  const lines: string[] = [];

  lines.push("ТОП ПО ЦЕНЕ ЗА М² (с учётом фильтров из config.ts):");
  if (input.topDeals.length === 0) lines.push("нет подходящих объектов");
  else input.topDeals.forEach((l, i) => lines.push(`${i + 1}. ${listingLine(l)}`));

  lines.push("");
  lines.push("НОВЫЕ ЗА ПОСЛЕДНИЕ 24 ЧАСА:");
  if (input.newOnes.length === 0) lines.push("новых подходящих объектов не найдено");
  else input.newOnes.forEach((l) => lines.push(listingLine(l)));

  lines.push("");
  lines.push("СНИЖЕНИЯ ЦЕН:");
  if (input.priceDrops.length === 0) lines.push("снижений цен не было");
  else
    input.priceDrops.forEach((d) =>
      lines.push(
        `[${d.listing.code}] ${d.listing.complexName || d.listing.title}: ${fmtPrice(d.oldPrice)} → ${fmtPrice(
          d.newPrice
        )} (−${d.pct.toFixed(1)}%)`
      )
    );

  lines.push("");
  lines.push("ИСТОЧНИКИ, КОТОРЫЕ НЕ ОТРАБОТАЛИ СЕГОДНЯ:");
  lines.push(input.sourceFailures.length === 0 ? "все источники отработали успешно" : input.sourceFailures.join(", "));

  return lines.join("\n");
}

const SYSTEM_PROMPT = `Ты — помощник ${config.myName}, который раз в день готовит короткую сводку по мониторингу недвижимости в Алматы для отправки в WhatsApp.

Пиши на русском, просто и по-человечески, без канцелярита и без лишних вступлений. Структура:
1. Короткое приветствие-заголовок с датой.
2. Топ-5 вариантов по цене за м² — для каждого: ЖК/название, комнаты, площадь, цена, район, ссылка.
3. Новые объекты за сутки (если есть) — кратко.
4. Снижения цен (если есть) — кратко, с процентом.
5. Если есть источники, которые не отработали — упомяни это одной строкой в конце, без драматизации.

Если по какому-то разделу нет данных — напиши это одной короткой фразой, не растягивай.
Не придумывай факты и цифры — используй только то, что дано в сообщении пользователя. Не используй markdown-разметку (звёздочки, решётки) — просто текст с эмодзи и переносами строк, т.к. сообщение идёт в WhatsApp.`;

/** Формирует текст дневной сводки через Claude API. */
export async function buildDailyDigest(input: DigestInput): Promise<string> {
  const today = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  const facts = buildFactsText(input);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.anthropicModel,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Сегодня ${today}. Вот данные за сегодняшний прогон:\n\n${facts}` }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  const text = (data.content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n")
    .trim();

  return text || facts; // запасной вариант — если Claude вернул пусто, шлём сырые факты
}
