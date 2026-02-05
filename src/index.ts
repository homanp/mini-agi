import { loadConfig } from "./config";
import { createToolRegistry } from "./tools";
import { createTelegramInterface } from "./interfaces/telegram";

async function main() {
  console.log("mini-agi starting...");

  // Load configuration
  const config = loadConfig();
  console.log(`Workspace: ${config.workspace.root}`);
  console.log(`LLM: ${config.llm.provider}/${config.llm.model}`);
  console.log(`Memory: ${config.memory.enabled ? "enabled" : "disabled"}`);

  // Create tool registry
  const toolRegistry = createToolRegistry(config);
  console.log(
    `Tools loaded: ${toolRegistry.tools.map((t) => t.name).join(", ")}`
  );

  // Create Telegram interface
  const telegram = createTelegramInterface({
    config,
    tools: toolRegistry.tools,
  });

  // Handle shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    telegram.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\nShutting down...");
    telegram.stop();
    process.exit(0);
  });

  // Start the bot
  await telegram.start();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
