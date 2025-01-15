module.exports = {
    apps: [{
      name: "character-app",
      script: "pnpm",
      args: "start",
      interpreter: "none",
      env: {
        NODE_ENV: "development"
      },
      env_production: {
        NODE_ENV: "production"
      },
      // Add your character argument
      args: ["start", "--character=characters/defaiza.character.json, characters/pleasures.character.json"],
      // Optional but recommended settings
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      // Log configuration
      out_file: "logs/out.log",
      error_file: "logs/error.log",
      merge_logs: true,
      time: true
    }]
  }