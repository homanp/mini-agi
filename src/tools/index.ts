import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Config } from "../config";
import { createBashTool } from "./just-bash";
import { createWebSearchTool } from "./web-search";

export interface ToolRegistry {
  tools: AgentTool[];
  getToolByName(name: string): AgentTool | undefined;
}

/**
 * Creates the tool registry with all available tools based on config.
 */
export function createToolRegistry(config: Config): ToolRegistry {
  const tools: AgentTool[] = [];

  // Add bash tool
  tools.push(
    createBashTool({
      workspaceRoot: config.workspace.root,
    })
  );

  // Add web search tool if configured
  if (config.webSearch.enabled) {
    tools.push(
      createWebSearchTool({
        apiKey: config.webSearch.apiKey,
      })
    );
  }

  return {
    tools,
    getToolByName(name) {
      return tools.find((t) => t.name === name);
    },
  };
}
