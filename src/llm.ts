import { config } from "./config.js";
import { Listing, ChatMessage, Proposal } from "./types.js";

// Системный промт диалога с хозяином. Первое приветствие уже отправлено отдельно,
// поэтому здесь агент продолжает переписку как тот же помощник.
function systemPrompt(listing: Listing, extra?: string): string {
  const base = `Ты — вежливый автоматический помощник, который от имени ${config.myName} организует просмотр квартиры. Ты переписываешься с хозяином объявления на Krisha.kz в WhatsApp.

ОБЪЯВЛЕНИЕ: «${listing.title}»${listing.address ? `, ${listing.address}` : ""}${listing.price ? `, ${listing.price} ₸` : ""}.

ПРАВИЛА:
1. Пиши на русском, коротко, уважительно, в деловом тоне (контекст — Казахстан). По одному сообщению за раз.
2. Ты — автоматический помощник ${config.myName}. Если уместно — напомни это. Не выдавай себя за живого человека.
3. НИКОГДА не придумывай дату и время просмотра сам. Когда нужно предложить хозяину время для просмотра (в начале, либо если хозяин отклонил предложенное и не назвал конкретную замену) — верни ТОЛЬКО строку без другого текста:
   {"action":"ask_user_datetime"}
   ${config.myName} пришлёт конкретные дату и время, и ты предложишь их хозяину.
4. Если хозяин назвал КОНКРЕТНЫЕ дату, время и место (сам или согласившись с предложенными) — верни ТОЛЬКО строку без другого текста:
   {"status":"time_proposed","date":"...","time":"...","place":"...","notes":"..."}
5. Во всех остальных случаях (уточнить актуальность, ответить на вопрос хозяина, уточнить адрес) — просто напиши обычное сообщение хозяину, без JSON.
6. НЕ обсуждай оплату, залог, предоплату, паспортные данные и ничего не переводи.
7. Если хозяин грубит, просит позвонить голосом или диалог в тупике — вежливо заверши обычным сообщением.`;

  return extra ? `${base}\n\n${extra}` : base;
}

export type DraftResult =
  | { kind: "message"; text: string }
  | { kind: "ask_datetime" }
  | { kind: "proposal"; proposal: Proposal };

export async function draftNextMessage(
  listing: Listing,
  history: ChatMessage[],
  extraInstruction?: string
): Promise<DraftResult> {
  // Anthropic API требует, чтобы messages начинались с роли "user".
  // История начинается с приветствия (assistant), поэтому отбрасываем всё до первого
  // сообщения хозяина (user). Дальше роли строго чередуются.
  const firstUser = history.findIndex((m) => m.role === "user");
  const trimmed = firstUser === -1 ? [] : history.slice(firstUser);
  const messages =
    trimmed.length === 0
      ? [{ role: "user", content: "Хозяин ответил, что объявление актуально." }]
      : trimmed.map((m) => ({ role: m.role, content: m.content }));

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.anthropicModel,
      max_tokens: 600,
      system: systemPrompt(listing, extraInstruction),
      messages,
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  const raw = (data.content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n")
    .trim();

  return parseDraft(raw);
}

function parseDraft(raw: string): DraftResult {
  const lines = raw.split("\n").filter((l) => l.trim());
  const last = (lines[lines.length - 1] || "").trim();
  if (last.startsWith("{")) {
    try {
      const obj = JSON.parse(last);
      if (obj.action === "ask_user_datetime") return { kind: "ask_datetime" };
      if (obj.status === "time_proposed") {
        return {
          kind: "proposal",
          proposal: {
            date: obj.date || "",
            time: obj.time || "",
            place: obj.place || "",
            notes: obj.notes || "",
          },
        };
      }
    } catch {
      /* не валидный JSON — трактуем как обычное сообщение */
    }
  }
  return { kind: "message", text: raw };
}
