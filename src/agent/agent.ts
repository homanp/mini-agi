import {
  Agent,
  type AgentTool,
  type AgentEvent,
} from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import type { Config } from "../config";
import { buildSystemPrompt } from "../prompt";

export interface MiniAgiAgent {
  prompt(message: string): AsyncGenerator<AgentEvent>;
  abort(): void;
  reset(): void;
  getMessages(): unknown[];
  restoreMessages(
    messages: Array<{ role: string; content: string; timestamp: number }>
  ): void;
  hasHistory(): boolean;
}

export interface CreateAgentOptions {
  config: Config;
  tools: AgentTool[];
  onEvent?: (event: AgentEvent) => void;
  bootstrap?: string;
  userProfile?: {
    name: string;
    taskPreferences: string;
  };
}

export function createAgent(options: CreateAgentOptions): MiniAgiAgent {
  const { config, tools, onEvent, bootstrap, userProfile } = options;

  // Cast needed because provider/model come from config at runtime
  const model = getModel(config.llm.provider as any, config.llm.model as any);
  const systemPrompt = buildSystemPrompt({
    workspaceRoot: config.workspace.root,
    bootstrap,
    userProfile,
  });

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      tools,
      thinkingLevel: "medium",
    },
  });

  if (onEvent) {
    agent.subscribe(onEvent);
  }

  return {
    async *prompt(message: string) {
      const eventQueue: AgentEvent[] = [];
      let resolveWait: (() => void) | null = null;
      let done = false;

      const unsubscribe = agent.subscribe((event) => {
        eventQueue.push(event);
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
        if (event.type === "agent_end") {
          done = true;
        }
      });

      // Start the prompt
      agent.prompt(message).catch((err) => {
        eventQueue.push({
          type: "agent_end",
          messages: [],
          error: err instanceof Error ? err.message : String(err),
        } as AgentEvent);
        done = true;
      });

      try {
        while (!done || eventQueue.length > 0) {
          if (eventQueue.length > 0) {
            yield eventQueue.shift()!;
          } else {
            await new Promise<void>((resolve) => {
              resolveWait = resolve;
            });
          }
        }
      } finally {
        unsubscribe();
      }
    },

    abort() {
      agent.abort();
    },

    reset() {
      agent.reset();
    },

    getMessages() {
      return agent.state.messages;
    },

    restoreMessages(
      messages: Array<{ role: string; content: string; timestamp: number }>
    ) {
      // Convert transcript entries to agent messages
      // pi-agent-core expects content as array of content blocks
      const agentMessages = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: [{ type: "text" as const, text: m.content }],
        }));
      if (agentMessages.length > 0) {
        agent.replaceMessages(agentMessages as any);
      }
    },

    hasHistory() {
      return agent.state.messages.length > 0;
    },
  };
}
