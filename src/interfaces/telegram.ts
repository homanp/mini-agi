import { Bot, Context, type Api, type RawApi } from "grammy";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Config } from "../config";
import { createAgent, type MiniAgiAgent } from "../agent/agent";
import { appendMemoryEntry, ensureMemoryDir } from "../memory/persistent";
import { loadUserProfile, saveUserProfile } from "../memory/profile";
import { loadMemoryBootstrap } from "../memory/bootstrap";
import {
  loadTranscript,
  appendTranscript,
  clearTranscript,
  ensureSessionDir,
  type TranscriptEntry,
} from "../session/transcript";

export interface TelegramInterface {
  start(): Promise<void>;
  stop(): void;
}

export interface CreateTelegramOptions {
  config: Config;
  tools: AgentTool[];
}

/**
 * Creates the Telegram bot interface for mini-agi.
 * Handles message routing, user authentication, and response streaming.
 */
export function createTelegramInterface(
  options: CreateTelegramOptions
): TelegramInterface {
  const { config, tools } = options;
  const bot = new Bot(config.telegram.botToken);
  const memoryEnabled = config.memory.enabled;

  // Initialize directories
  if (memoryEnabled) {
    ensureMemoryDir(config.memory.dir).catch((err) => {
      console.error("Failed to initialize memory directory:", err);
    });
  }
  ensureSessionDir(config.session.dir).catch((err) => {
    console.error("Failed to initialize session directory:", err);
  });

  // Per-user agent instances (simple session management)
  const userAgents = new Map<string, MiniAgiAgent>();
  const agentInitialized = new Map<string, boolean>();
  const onboardingStage = new Map<string, "ask_name" | "ask_tasks">();

  async function getOrCreateAgent(userId: string): Promise<MiniAgiAgent> {
    let agent = userAgents.get(userId);

    if (!agent) {
      // Load bootstrap, profile, and transcript for this user
      const bootstrap = memoryEnabled
        ? await loadMemoryBootstrap({ memoryDir: config.memory.dir })
        : undefined;

      const profile = memoryEnabled
        ? await loadUserProfile(config.memory.dir, userId)
        : null;

      console.log(`Creating agent for user: ${userId}`);
      agent = createAgent({
        config,
        tools,
        bootstrap,
        userProfile: profile
          ? { name: profile.name, taskPreferences: profile.taskPreferences }
          : undefined,
        onEvent: (event) => {
          if (event.type === "tool_execution_start") {
            console.log(`[${userId}] Tool: ${event.toolName}`);
          }
        },
      });

      // Load and restore transcript if exists
      const transcript = await loadTranscript(config.session.dir, userId);
      if (transcript.length > 0) {
        console.log(
          `Restoring ${transcript.length} messages for user: ${userId}`
        );
        agent.restoreMessages(transcript);
        agentInitialized.set(userId, true);
      }

      userAgents.set(userId, agent);
    }

    return agent;
  }

  function isUserAllowed(ctx: Context): boolean {
    const allowedUsers = config.telegram.allowedUsers;
    if (allowedUsers.length === 0) {
      return true; // No allowlist = allow all
    }
    const userId = ctx.from?.id?.toString();
    const username = ctx.from?.username;
    return Boolean(
      (userId && allowedUsers.includes(userId)) ||
        (username && allowedUsers.includes(username))
    );
  }

  // Middleware: check user authorization
  bot.use(async (ctx, next) => {
    if (!isUserAllowed(ctx)) {
      await ctx.reply("Sorry, you're not authorized to use this bot.");
      return;
    }
    await next();
  });

  // /start command
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Hello! I'm mini-agi, your personal coding assistant.\n\n" +
        "I can help you with:\n" +
        "- Executing shell commands\n" +
        "- Reading and writing files\n" +
        "- Coding tasks\n\n" +
        "Just send me a message with what you'd like to do!"
    );
  });

  // /reset command - clear conversation history
  bot.command("reset", async (ctx) => {
    const userId = ctx.from?.id?.toString();
    if (userId) {
      const agent = userAgents.get(userId);
      if (agent) {
        agent.reset();
      }
      userAgents.delete(userId);
      agentInitialized.delete(userId);
      onboardingStage.delete(userId);

      // Clear transcript
      await clearTranscript(config.session.dir, userId);

      await ctx.reply("Conversation reset. Starting fresh!");
    }
  });

  // /stop command - abort current operation
  bot.command("stop", async (ctx) => {
    const userId = ctx.from?.id?.toString();
    if (userId) {
      const agent = userAgents.get(userId);
      if (agent) {
        agent.abort();
        await ctx.reply("Operation aborted.");
      }
    }
  });

  // Handle text messages
  bot.on("message:text", async (ctx) => {
    const userId = ctx.from?.id?.toString();
    if (!userId) return;

    const userMessage = ctx.message.text;

    // Load or initialize user profile
    let profile = memoryEnabled
      ? await loadUserProfile(config.memory.dir, userId)
      : null;

    // Handle onboarding if no profile
    if (memoryEnabled && !profile) {
      const stage = onboardingStage.get(userId) ?? "ask_name";
      onboardingStage.set(userId, stage);

      if (stage === "ask_name") {
        onboardingStage.set(userId, "ask_tasks");
        await ctx.reply("Hi! I'm mini-agi. What name should I call you?");
        return;
      }

      if (stage === "ask_tasks") {
        const existingProfile = await loadUserProfile(
          config.memory.dir,
          userId
        );
        if (!existingProfile?.name) {
          // Save name and ask for tasks
          await saveUserProfile(config.memory.dir, {
            userId,
            name: userMessage.trim(),
            taskPreferences: "",
            updatedAt: new Date().toISOString(),
          });
          await ctx.reply(
            `Nice to meet you, ${userMessage.trim()}! What kinds of tasks do you want me to help with?`
          );
          return;
        }

        // Save task preferences
        await saveUserProfile(config.memory.dir, {
          userId,
          name: existingProfile.name,
          taskPreferences: userMessage.trim(),
          updatedAt: new Date().toISOString(),
        });
        onboardingStage.delete(userId);
        await ctx.reply(
          "Got it. Thanks! You can now ask me anything, and I'll remember this."
        );
        return;
      }
    }

    // Get or create agent with restored context
    const agent = await getOrCreateAgent(userId);

    // Send typing indicator
    let lastTypingTime = 0;
    const TYPING_INTERVAL = 4000;

    let responseText = "";
    let lastUpdateTime = 0;
    const UPDATE_INTERVAL = 1000;
    let sentMessage: Awaited<ReturnType<typeof ctx.reply>> | null = null;

    try {
      // Kick off typing indicator
      try {
        await ctx.replyWithChatAction("typing");
        lastTypingTime = Date.now();
      } catch {
        // Ignore rate limit errors
      }
      await new Promise((resolve) => setTimeout(resolve, 800));

      for await (const event of agent.prompt(userMessage)) {
        // Debug: log all events
        console.log(`[${userId}] Event: ${event.type}`, JSON.stringify(event).slice(0, 200));

        // Keep typing indicator active
        const nowTyping = Date.now();
        if (nowTyping - lastTypingTime > TYPING_INTERVAL) {
          lastTypingTime = nowTyping;
          try {
            await ctx.replyWithChatAction("typing");
          } catch {
            // Ignore rate limit errors
          }
        }

        if (event.type === "message_update") {
          const msgEvent = event.assistantMessageEvent;
          if (msgEvent.type === "text_delta") {
            responseText += msgEvent.delta;

            // Throttle message updates
            const now = Date.now();
            if (!sentMessage && responseText.length > 0) {
              sentMessage = await ctx.reply(responseText);
              lastUpdateTime = now;
            } else if (
              sentMessage &&
              now - lastUpdateTime > UPDATE_INTERVAL &&
              responseText.length > 0
            ) {
              lastUpdateTime = now;
              try {
                await editMessage(
                  ctx.api,
                  ctx.chat.id,
                  sentMessage.message_id,
                  responseText
                );
              } catch {
                // Ignore edit errors
              }
            }
          }
        } else if (event.type === "tool_execution_start") {
          const toolInfo = `🔧 Running: ${event.toolName}`;
          if (sentMessage) {
            try {
              await editMessage(
                ctx.api,
                ctx.chat.id,
                sentMessage.message_id,
                responseText + (responseText ? "\n\n" : "") + toolInfo
              );
            } catch {
              // Ignore edit errors
            }
          }
        } else if (event.type === "agent_end") {
          // Final update
          if (responseText.trim()) {
            if (sentMessage) {
              await editMessage(
                ctx.api,
                ctx.chat.id,
                sentMessage.message_id,
                responseText
              );
            } else {
              await ctx.reply(responseText);
            }
          } else {
            if (!sentMessage) {
              await ctx.reply("Done!");
            }
          }
        }
      }

      // Save to transcript (JSONL)
      const timestamp = Date.now();
      const transcriptEntries: TranscriptEntry[] = [
        { role: "user", content: userMessage, timestamp },
      ];
      if (responseText.trim()) {
        transcriptEntries.push({
          role: "assistant",
          content: responseText.trim(),
          timestamp,
        });
      }
      await appendTranscript(config.session.dir, userId, transcriptEntries);
      agentInitialized.set(userId, true);

      // Save to memory (markdown files)
      if (memoryEnabled && responseText.trim()) {
        try {
          await appendMemoryEntry(config.memory.dir, {
            userId,
            userMessage,
            assistantMessage: responseText.trim(),
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          console.error("Failed to persist memory:", error);
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "An unexpected error occurred";
      if (sentMessage) {
        await editMessage(
          ctx.api,
          ctx.chat.id,
          sentMessage.message_id,
          `❌ Error: ${errorMessage}`
        );
      } else {
        await ctx.reply(`❌ Error: ${errorMessage}`);
      }
    }
  });

  // Error handler
  bot.catch((err) => {
    console.error("Telegram bot error:", err);
  });

  return {
    async start() {
      console.log("Starting Telegram bot...");
      await bot.start({
        onStart: (botInfo) => {
          console.log(`Bot started as @${botInfo.username}`);
        },
      });
    },

    stop() {
      bot.stop();
      console.log("Telegram bot stopped");
    },
  };
}

/**
 * Helper to edit a message with proper truncation for Telegram's limits.
 */
async function editMessage(
  api: Api<RawApi>,
  chatId: number,
  messageId: number,
  text: string
): Promise<void> {
  const MAX_LENGTH = 4000;
  let truncatedText = text;

  if (text.length > MAX_LENGTH) {
    truncatedText = text.slice(0, MAX_LENGTH) + "\n\n... (truncated)";
  }

  await api.editMessageText(chatId, messageId, truncatedText, {
    parse_mode: undefined,
  });
}
