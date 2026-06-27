// Запускатель агента для pm2. Node.js (CJS) запускает tsx через дочерний процесс.
const { spawn } = require("child_process");
const path = require("path");

const cwd = path.dirname(__filename);

const child = spawn("cmd.exe", ["/c", "npx", "tsx", "src/index.ts"], {
  cwd,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

process.on("SIGINT",  () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
