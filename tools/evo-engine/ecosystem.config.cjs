const path = require("path");

module.exports = {
  apps: [
    {
      name: "evo-engine",
      cwd: __dirname,
      script: path.join(__dirname, "test/.venv/bin/uvicorn"),
      args: "app.main:app --host 0.0.0.0 --port 8000 --workers 1",
      interpreter: "none",
      env: {
        PYTHONPATH: __dirname,
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      error_file: path.join(__dirname, "logs/pm2-error.log"),
      out_file: path.join(__dirname, "logs/pm2-out.log"),
      merge_logs: true,
      time: true,
    },
  ],
};
