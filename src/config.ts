import "dotenv/config";

export interface Config {
  telegram: {
    botToken: string;
    allowedUsers: string[]; // Telegram user IDs or usernames
  };
  llm: {
    provider: "anthropic" | "openai" | "google";
    model: string;
  };
  webSearch: {
    enabled: boolean;
    apiKey: string; // Brave Search API key
  };
  memory: {
    enabled: boolean;
    dir: string; // Directory to store conversation memory files
  };
  session: {
    dir: string; // Directory to store session transcripts
  };
  workspace: {
    root: string; // Root directory for file operations
  };
  mcp: {
    enabled: boolean;
    configPath: string; // Path to mcp-servers.json
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

export function loadConfig(): Config {
  return {
    telegram: {
      botToken: requireEnv("TELEGRAM_BOT_TOKEN"),
      allowedUsers: optionalEnv("TELEGRAM_ALLOWED_USERS", "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    },
    llm: {
      provider: optionalEnv(
        "LLM_PROVIDER",
        "anthropic"
      ) as Config["llm"]["provider"],
      model: optionalEnv("LLM_MODEL", "claude-sonnet-4-20250514"),
    },
    webSearch: {
      enabled: !!process.env.BRAVE_API_KEY,
      apiKey: optionalEnv("BRAVE_API_KEY", ""),
    },
    memory: {
      enabled: optionalEnv("MEMORY_ENABLED", "true") === "true",
      dir: optionalEnv(
        "MEMORY_DIR",
        `${optionalEnv("WORKSPACE_ROOT", process.cwd())}/memory`
      ),
    },
    session: {
      dir: optionalEnv(
        "SESSION_DIR",
        `${optionalEnv("WORKSPACE_ROOT", process.cwd())}/session`
      ),
    },
    workspace: {
      root: optionalEnv("WORKSPACE_ROOT", process.cwd()),
    },
    mcp: {
      enabled: optionalEnv("MCP_ENABLED", "true") === "true",
      // MCP config is part of mini-agi, use cwd (project dir) not workspace
      configPath: optionalEnv(
        "MCP_CONFIG_PATH",
        `${process.cwd()}/mcp-servers.json`
      ),
    },
  };
}
