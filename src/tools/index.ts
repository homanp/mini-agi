import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Config } from "../config";
import { createBashTool } from "./just-bash";
import { createAgentBrowserTool } from "./agent-browser";
import { createTaskMemoryTool } from "./task-memory";
import { createFetchUrlTool } from "./fetch-url";
import { createWebSearchTool } from "./web-search";
import { MCPClientManager, loadMCPConfig, convertAllMCPTools } from "../mcp";

export interface ToolRegistry {
  tools: AgentTool[];
  getToolByName(name: string): AgentTool | undefined;
  /** Cleanup function to disconnect MCP servers */
  cleanup(): Promise<void>;
}

/**
 * Creates the tool registry with all available tools based on config.
 * This is now async to support MCP server initialization.
 */
export async function createToolRegistry(
  config: Config
): Promise<ToolRegistry> {
  const tools: AgentTool[] = [];
  let mcpClient: MCPClientManager | null = null;

  // Add bash tool
  tools.push(
    createBashTool({
      workspaceRoot: config.workspace.root,
    })
  );

  // Add dedicated browser automation tool (auto CDP + auto launch)
  tools.push(
    createAgentBrowserTool({
      workspaceRoot: config.workspace.root,
    })
  );

  if (config.memory.enabled) {
    tools.push(
      createTaskMemoryTool({
        memoryDir: config.memory.dir,
      })
    );
  }

  // Add web search tool if configured
  if (config.webSearch.enabled) {
    tools.push(
      createWebSearchTool({
        apiKey: config.webSearch.apiKey,
      })
    );
  }

  // Add fetch URL tool (always available)
  tools.push(createFetchUrlTool());

  // Load and connect to MCP servers if enabled
  if (config.mcp.enabled) {
    try {
      const mcpConfig = await loadMCPConfig(config.mcp.configPath);
      const serverCount = Object.keys(mcpConfig.mcpServers).length;

      if (serverCount > 0) {
        console.log(
          `[MCP] Loading ${serverCount} server(s) from ${config.mcp.configPath}`
        );

        mcpClient = new MCPClientManager();
        await mcpClient.connectAll(mcpConfig);

        // Convert MCP tools to AgentTools and add them
        const mcpTools = convertAllMCPTools(mcpClient);
        tools.push(...mcpTools);

        console.log(`[MCP] Loaded ${mcpTools.length} tool(s) from MCP servers`);
      }
    } catch (error) {
      console.error(
        "[MCP] Failed to initialize MCP servers:",
        error instanceof Error ? error.message : error
      );
    }
  }

  return {
    tools,
    getToolByName(name) {
      return tools.find((t) => t.name === name);
    },
    async cleanup() {
      if (mcpClient) {
        await mcpClient.disconnectAll();
      }
    },
  };
}
