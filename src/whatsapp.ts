// Отправка сообщений в WhatsApp через Green API. Один запуск = один набор отправок, без приёма входящих.
import { config } from "./config.js";

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

/** Отправка текста. */
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
