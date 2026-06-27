// WhatsApp через Green API. Приём сообщений — опросом (polling), без webhook/туннеля.
import { config } from "./config.js";
import { IncomingMessage } from "./types.js";

const g = () => config.green;
const url = (method: string) =>
  `${g().apiUrl}/waInstance${g().idInstance}/${method}/${g().apiToken}`;
const chatId = (phone: string) => `${phone.replace(/\D/g, "")}@c.us`;

async function postJson(method: string, body: unknown): Promise<any> {
  const res = await fetch(url(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Green API ${method} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

/** Отправка текста. Green API не требует шаблонов — можно писать кому угодно. */
export async function sendText(to: string, text: string): Promise<void> {
  await postJson("sendMessage", { chatId: chatId(to), message: text });
}

export async function sendImage(to: string, link: string, caption?: string): Promise<void> {
  await postJson("sendFileByUrl", {
    chatId: chatId(to),
    urlFile: link,
    fileName: "photo.jpg",
    caption: caption || "",
  });
}

// ───────── Приём сообщений (long-polling) ─────────

interface Notification {
  receiptId: number;
  incoming: IncomingMessage | null;
}

/** Забирает следующее уведомление. Возвращает null, если очередь пуста. */
async function receiveNext(): Promise<Notification | null> {
  const res = await fetch(url("receiveNotification"), { method: "GET" });
  if (!res.ok) throw new Error(`receiveNotification ${res.status}`);
  const data: any = await res.json();
  if (!data || !data.receiptId) return null;
  return { receiptId: data.receiptId, incoming: parseNotification(data.body) };
}

async function ack(receiptId: number): Promise<void> {
  await fetch(`${g().apiUrl}/waInstance${g().idInstance}/deleteNotification/${g().apiToken}/${receiptId}`, {
    method: "DELETE",
  }).catch(() => {});
}

function parseNotification(body: any): IncomingMessage | null {
  try {
    if (body?.typeWebhook !== "incomingMessageReceived") return null; // игнорируем исходящие/прочее
    const chat = body.senderData?.chatId || "";
    if (chat.endsWith("@g.us")) return null; // пропускаем групповые чаты
    const md = body.messageData || {};
    let text = "";
    if (md.typeMessage === "textMessage") text = md.textMessageData?.textMessage || "";
    else if (md.typeMessage === "extendedTextMessage") text = md.extendedTextMessageData?.text || "";
    else return null;
    return {
      from: chat.replace("@c.us", ""),
      text,
      at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Бесконечный цикл опроса. Каждое входящее сообщение передаётся в handler. */
export async function startPolling(handler: (m: IncomingMessage) => Promise<void>): Promise<void> {
  console.log("[green] опрос входящих сообщений запущен");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const n = await receiveNext();
      if (n) {
        if (n.incoming) {
          try {
            await handler(n.incoming);
          } catch (e) {
            console.error("[green] ошибка обработки:", (e as Error).message);
          }
        }
        await ack(n.receiptId);
      }
    } catch (e) {
      console.error("[green] ошибка опроса:", (e as Error).message);
      await new Promise((r) => setTimeout(r, g().pollIntervalMs));
    }
  }
}
