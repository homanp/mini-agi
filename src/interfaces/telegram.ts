import { Bot, Context, type Api, type RawApi } from "grammy";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Config } from "../config";
import { createAgent, type MiniAgiAgent } from "../agent/agent";
import { buildSystemPrompt } from "../prompt";
import { appendMemoryEntry, ensureMemoryDir } from "../memory/persistent";
import { loadUserProfile, saveUserProfile } from "../memory/profile";
import { loadMemoryBootstrap } from "../memory/bootstrap";
import {
  appendTaskMemory,
  consumeTaskTouches,
  summarizeActiveTasksForPrompt,
} from "../memory/tasks";
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
    ensureMemoryDir(config.memory.dir).catch((err: unknown) => {
      console.error("Failed to initialize memory directory:", err);
    });
  }
  ensureSessionDir(config.session.dir).catch((err: unknown) => {
    console.error("Failed to initialize session directory:", err);
  });

  // Per-user agent instances (simple session management)
  const userAgents = new Map<string, MiniAgiAgent>();
  const agentInitialized = new Map<string, boolean>();
  const onboardingStage = new Map<string, "ask_name" | "ask_tasks">();
  const activeTasksMaxChars = Number(
    process.env.ACTIVE_TASKS_CONTEXT_MAX_CHARS ?? "3000"
  );
  const activeTasksMaxItems = Number(
    process.env.ACTIVE_TASKS_CONTEXT_MAX_ITEMS ?? "8"
  );

  async function buildLiveSystemPrompt(userId: string): Promise<string> {
    const bootstrap = memoryEnabled
      ? await loadMemoryBootstrap({ memoryDir: config.memory.dir })
      : undefined;
    const profile = memoryEnabled
      ? await loadUserProfile(config.memory.dir, userId)
      : null;
    const activeTasksContext = memoryEnabled
      ? await summarizeActiveTasksForPrompt(
          config.memory.dir,
          userId,
          Number.isFinite(activeTasksMaxChars) ? activeTasksMaxChars : 3000,
          Number.isFinite(activeTasksMaxItems) ? activeTasksMaxItems : 8
        )
      : undefined;

    return buildSystemPrompt({
      workspaceRoot: config.workspace.root,
      bootstrap,
      activeTasksContext,
      userProfile: profile
        ? { name: profile.name, taskPreferences: profile.taskPreferences }
        : undefined,
      additionalContext:
        `Current user id for task_memory tool: ${userId}\n` +
        "Always pass this exact value in task_memory.user_id.",
    });
  }

  async function refreshAgentSystemPrompt(
    userId: string,
    agent: MiniAgiAgent
  ): Promise<void> {
    const systemPrompt = await buildLiveSystemPrompt(userId);
    agent.setSystemPrompt(systemPrompt);
  }

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

      const activeTasksContext = memoryEnabled
        ? await summarizeActiveTasksForPrompt(
            config.memory.dir,
            userId,
            Number.isFinite(activeTasksMaxChars) ? activeTasksMaxChars : 3000,
            Number.isFinite(activeTasksMaxItems) ? activeTasksMaxItems : 8
          )
        : undefined;

      console.log(`Creating agent for user: ${userId}`);
      agent = createAgent({
        config,
        tools,
        bootstrap,
        activeTasksContext,
        additionalContext:
          `Current user id for task_memory tool: ${userId}\n` +
          "Always pass this exact value in task_memory.user_id.",
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
    await refreshAgentSystemPrompt(userId, agent);
    consumeTaskTouches(userId);

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
              sentMessage = await replyWithFormatting(ctx, responseText);
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
        } else if (event.type === "message_end") {
          // Some cached/provider paths may emit no text deltas.
          // Recover assistant text from the finalized assistant message.
          if (!responseText.trim()) {
            const endedText = extractAssistantTextFromMessage(
              (event as unknown as { message?: unknown }).message
            );
            if (endedText.trim()) {
              responseText = endedText;
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
          if (!responseText.trim()) {
            const fallback = extractAssistantTextFromAgentEnd(
              event as unknown as { messages?: unknown[] }
            );
            if (fallback.trim()) {
              responseText = fallback;
            }
          }

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
              await replyWithFormatting(ctx, responseText);
            }
          } else {
            if (!sentMessage) {
              await ctx.reply("I didn't get a response text from the model. Please retry.");
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

      if (memoryEnabled && responseText.trim()) {
        const touchedTasks = consumeTaskTouches(userId);
        if (touchedTasks.length > 0) {
          const progressNote = buildTaskProgressNote(userMessage, responseText);
          for (const touched of touchedTasks) {
            try {
              await appendTaskMemory(
                config.memory.dir,
                userId,
                touched.taskId,
                `${progressNote}\n\nSource action: ${touched.action}`
              );
            } catch (error) {
              console.error(
                `Failed to append task memory for ${touched.taskId}:`,
                error
              );
            }
          }
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
          `Error: ${errorMessage}`
        );
      } else {
        await replyWithFormatting(ctx, `Error: ${errorMessage}`);
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

function buildTaskProgressNote(userMessage: string, responseText: string): string {
  const compact = (text: string, maxLen: number): string => {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLen) return normalized;
    return normalized.slice(0, maxLen) + "...";
  };

  return [
    `User update: ${compact(userMessage, 350)}`,
    `Assistant progress: ${compact(responseText, 700)}`,
  ].join("\n");
}

function extractAssistantTextFromAgentEnd(event: {
  messages?: unknown[];
}): string {
  const msgs = Array.isArray(event.messages) ? event.messages : [];
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const text = extractAssistantTextFromMessage(msgs[i]);
    if (text.trim()) return text;
  }
  return "";
}

function extractAssistantTextFromMessage(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const msg = message as { role?: unknown; content?: unknown };
  if (msg.role !== "assistant") return "";

  if (typeof msg.content === "string") return msg.content;
  if (!Array.isArray(msg.content)) return "";

  const parts: string[] = [];
  for (const block of msg.content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: unknown; text?: unknown };
    if (b.type === "text" && typeof b.text === "string") {
      parts.push(b.text);
    }
  }
  return parts.join("");
}

/**
 * Helper to edit a message with proper truncation for Telegram limits.
 */
async function editMessage(
  api: Api<RawApi>,
  chatId: number,
  messageId: number,
  text: string
): Promise<void> {
  const MAX_LENGTH = 4000;
  const formatted = formatTelegramOutput(text);
  let finalText = formatted.text;
  let finalEntities = formatted.entities;

  if (finalText.length > MAX_LENGTH) {
    const suffix = "\n\n... (truncated)";
    const cutoff = Math.max(0, MAX_LENGTH - suffix.length);
    finalText = finalText.slice(0, cutoff) + suffix;
    finalEntities = trimEntitiesToLength(finalEntities, cutoff);
  }

  try {
    await api.editMessageText(chatId, messageId, finalText, {
      parse_mode: undefined,
      entities: finalEntities.length > 0 ? finalEntities : undefined,
    });
  } catch (error) {
    // Telegram returns 400 when trying to edit to identical content.
    // Treat this as a no-op so streaming updates remain stable.
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("message is not modified")) {
      return;
    }
    throw error;
  }
}

async function replyWithFormatting(ctx: Context, text: string) {
  const MAX_LENGTH = 4000;
  const formatted = formatTelegramOutput(text);
  let finalText = formatted.text;
  let finalEntities = formatted.entities;

  if (finalText.length > MAX_LENGTH) {
    const suffix = "\n\n... (truncated)";
    const cutoff = Math.max(0, MAX_LENGTH - suffix.length);
    finalText = finalText.slice(0, cutoff) + suffix;
    finalEntities = trimEntitiesToLength(finalEntities, cutoff);
  }

  return ctx.reply(finalText, {
    parse_mode: undefined,
    entities: finalEntities.length > 0 ? finalEntities : undefined,
  });
}

type TelegramEntity = {
  type: "bold" | "code" | "pre";
  offset: number;
  length: number;
};

function formatTelegramOutput(text: string): {
  text: string;
  entities: TelegramEntity[];
} {
  const normalized = normalizeFormattingInput(text);
  const entities: TelegramEntity[] = [];
  let out = "";
  let i = 0;

  while (i < normalized.length) {
    if (normalized.startsWith("```", i)) {
      const close = normalized.indexOf("```", i + 3);
      if (close !== -1) {
        let block = normalized.slice(i + 3, close);
        const newlineIdx = block.indexOf("\n");
        if (newlineIdx !== -1) {
          const firstLine = block.slice(0, newlineIdx).trim();
          if (/^[a-zA-Z0-9_+-]{1,32}$/.test(firstLine)) {
            block = block.slice(newlineIdx + 1);
          }
        }
        const offset = out.length;
        out += block;
        if (block.length > 0) {
          entities.push({ type: "pre", offset, length: block.length });
        }
        i = close + 3;
        continue;
      }
    }

    if (normalized.startsWith("**", i)) {
      const close = normalized.indexOf("**", i + 2);
      if (close !== -1) {
        const content = normalized.slice(i + 2, close);
        const offset = out.length;
        out += content;
        if (content.length > 0) {
          entities.push({ type: "bold", offset, length: content.length });
        }
        i = close + 2;
        continue;
      }
    }

    if (normalized[i] === "`") {
      const close = normalized.indexOf("`", i + 1);
      if (close !== -1) {
        const content = normalized.slice(i + 1, close);
        const offset = out.length;
        out += content;
        if (content.length > 0) {
          entities.push({ type: "code", offset, length: content.length });
        }
        i = close + 1;
        continue;
      }
    }

    out += normalized[i];
    i += 1;
  }

  return { text: out, entities };
}

function normalizeFormattingInput(text: string): string {
  if (!text) return "";

  return text
    // Convert common HTML-like formatting into marker syntax we can convert to entities.
    .replace(/<\s*(strong|b)\s*>/gi, "**")
    .replace(/<\s*\/\s*(strong|b)\s*>/gi, "**")
    .replace(/<\s*code\s*>/gi, "`")
    .replace(/<\s*\/\s*code\s*>/gi, "`")
    .replace(/<\s*pre(?:\s+[^>]*)?\s*>/gi, "```")
    .replace(/<\s*\/\s*pre\s*>/gi, "```")
    // Drop leftover tags.
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    // Decode common entities.
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    // Normalize excessive blank lines for readability.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function trimEntitiesToLength(
  entities: TelegramEntity[],
  maxLength: number
): TelegramEntity[] {
  return entities
    .filter((entity) => entity.offset < maxLength)
    .map((entity) => ({
      ...entity,
      length: Math.min(entity.length, maxLength - entity.offset),
    }))
    .filter((entity) => entity.length > 0);
}
