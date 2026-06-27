module.exports = {
  apps: [
    {
      name: "krisha-agent",
      script: "runner.cjs",
      cwd: "C:\\Users\\7em\\Desktop\\krisha-agent",

      // Автоперезапуск при падении
      restart_delay: 5000,
      max_restarts: 20,
      exp_backoff_restart_delay: 100,

      // Логи
      log_date_format: "DD.MM.YYYY HH:mm:ss",
      out_file: "logs/agent.log",
      error_file: "logs/agent-error.log",
      merge_logs: true,

      max_memory_restart: "500M",
    },
  ],
};
