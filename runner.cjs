// Запускатель агента для pm2. Работает на Windows и Linux.
const { spawn } = require("child_process");
const path = require("path");

const cwd = path.dirname(__filename);
const isWindows = process.platform === "win32";

const child = spawn(
  isWindows ? "cmd.exe" : "npx",
  isWindows ? ["/c", "npx", "tsx", "src/index.ts"] : ["tsx", "src/index.ts"],
  { cwd, stdio: "inherit", env: process.env }
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

process.on("SIGINT",  () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
