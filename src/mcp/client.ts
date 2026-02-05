import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MCPServersConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

interface ConnectedServer {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  tools: Tool[];
}

/**
 * Manages connections to multiple MCP servers.
 */
export class MCPClientManager {
  private servers: Map<string, ConnectedServer> = new Map();

  /**
   * Connect to all MCP servers defined in the config.
   */
  async connectAll(config: MCPServersConfig): Promise<void> {
    const entries = Object.entries(config.mcpServers);

    for (const [name, serverConfig] of entries) {
      try {
        await this.connectServer(name, serverConfig);
        console.log(`[MCP] Connected to server: ${name}`);
      } catch (error) {
        console.error(
          `[MCP] Failed to connect to server ${name}:`,
          error instanceof Error ? error.message : error
        );
      }
    }
  }

  /**
   * Connect to a single MCP server.
   */
  private async connectServer(
    name: string,
    config: MCPServerConfig
  ): Promise<void> {
    // Build env, filtering out undefined values
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    if (config.env) {
      Object.assign(env, config.env);
    }

    // Create transport - it handles spawning the process
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env,
      stderr: "pipe",
    });

    // Log stderr for debugging
    transport.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        console.error(`[MCP:${name}] ${msg}`);
      }
    });

    // Create and connect client
    const client = new Client(
      { name: "mini-agi", version: "0.1.0" },
      { capabilities: {} }
    );

    await client.connect(transport);

    // List available tools
    const toolsResult = await client.listTools();
    const tools = toolsResult.tools;

    console.log(
      `[MCP:${name}] Found ${tools.length} tools: ${tools
        .map((t) => t.name)
        .join(", ")}`
    );

    this.servers.set(name, {
      name,
      client,
      transport,
      tools,
    });
  }

  /**
   * Get all tools from all connected servers.
   * Returns tools with their server name for routing.
   */
  getAllTools(): Array<{ serverName: string; tool: Tool }> {
    const allTools: Array<{ serverName: string; tool: Tool }> = [];

    for (const [serverName, server] of this.servers) {
      for (const tool of server.tools) {
        allTools.push({ serverName, tool });
      }
    }

    return allTools;
  }

  /**
   * Call a tool on a specific server.
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`MCP server not found: ${serverName}`);
    }

    const result = await server.client.callTool({
      name: toolName,
      arguments: args,
    });

    return result;
  }

  /**
   * Disconnect from all servers and clean up.
   */
  async disconnectAll(): Promise<void> {
    for (const [name, server] of this.servers) {
      try {
        await server.client.close();
        console.log(`[MCP] Disconnected from server: ${name}`);
      } catch (error) {
        console.error(
          `[MCP] Error disconnecting from ${name}:`,
          error instanceof Error ? error.message : error
        );
      }
    }
    this.servers.clear();
  }

  /**
   * Check if any servers are connected.
   */
  hasConnections(): boolean {
    return this.servers.size > 0;
  }

  /**
   * Get list of connected server names.
   */
  getConnectedServers(): string[] {
    return Array.from(this.servers.keys());
  }
}

/**
 * Load MCP servers config from a JSON file.
 */
export async function loadMCPConfig(
  configPath: string
): Promise<MCPServersConfig> {
  try {
    const file = Bun.file(configPath);
    const exists = await file.exists();

    if (!exists) {
      console.log(`[MCP] Config file not found: ${configPath}`);
      return { mcpServers: {} };
    }

    const content = await file.text();
    const config = JSON.parse(content) as MCPServersConfig;

    return config;
  } catch (error) {
    console.error(
      `[MCP] Failed to load config from ${configPath}:`,
      error instanceof Error ? error.message : error
    );
    return { mcpServers: {} };
  }
}
