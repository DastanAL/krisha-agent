import { config } from "./config.js";
import { startPolling } from "./whatsapp.js";
import { dispatch } from "./commands.js";
import { startScheduler, runPipeline } from "./scheduler.js";

function checkEnv(): void {
  const missing: string[] = [];
  if (!config.myWhatsApp) missing.push("MY_WHATSAPP");
  if (!config.anthropicApiKey) missing.push("ANTHROPIC_API_KEY");
  if (!config.green.idInstance) missing.push("GREEN_API_ID_INSTANCE");
  if (!config.green.apiToken) missing.push("GREEN_API_TOKEN");
  if (missing.length) {
    console.warn("⚠️  Не заданы переменные окружения:", missing.join(", "));
    console.warn("    Заполни .env (см. README), иначе часть функций не заработает.\n");
  }
}

async function main(): Promise<void> {
  checkEnv();
  console.log("🚀 Krisha Agent запущен");

  // Мониторинг по расписанию + первый прогон сразу.
  startScheduler();
  runPipeline().catch((e) => console.error("[pipeline] стартовый прогон:", e));

  // Приём сообщений из WhatsApp (бесконечный опрос).
  await startPolling(dispatch);
}

main().catch((e) => {
  console.error("Фатальная ошибка:", e);
  process.exit(1);
});
