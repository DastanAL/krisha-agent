module.exports = {
  apps: [
    {
      name: "krisha-agent",
      script: "runner.cjs",
      cwd: __dirname,

      restart_delay: 5000,
      max_restarts: 20,
      exp_backoff_restart_delay: 100,

      log_date_format: "DD.MM.YYYY HH:mm:ss",
      out_file: "logs/agent.log",
      error_file: "logs/agent-error.log",
      merge_logs: true,

      max_memory_restart: "500M",
    },
  ],
};
