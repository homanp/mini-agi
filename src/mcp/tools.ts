import { Type, type TSchema } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { MCPClientManager } from "./client";

/**
 * Convert a JSON Schema type to a TypeBox schema.
 * Handles common types used in MCP tool parameters.
 */
function jsonSchemaToTypeBox(schema: Record<string, unknown>): TSchema {
  const type = schema.type as string | undefined;
  const description = schema.description as string | undefined;

  switch (type) {
    case "string":
      return Type.String({ description });

    case "number":
    case "integer":
      return Type.Number({ description });

    case "boolean":
      return Type.Boolean({ description });

    case "array": {
      const items = schema.items as Record<string, unknown> | undefined;
      const itemSchema = items ? jsonSchemaToTypeBox(items) : Type.Unknown();
      return Type.Array(itemSchema, { description });
    }

    case "object": {
      const properties = schema.properties as
        | Record<string, Record<string, unknown>>
        | undefined;
      const required = (schema.required as string[]) ?? [];

      if (!properties) {
        return Type.Object({}, { description });
      }

      const typeboxProps: Record<string, TSchema> = {};

      for (const [key, propSchema] of Object.entries(properties)) {
        const propTypeBox = jsonSchemaToTypeBox(propSchema);
        typeboxProps[key] = required.includes(key)
          ? propTypeBox
          : Type.Optional(propTypeBox);
      }

      return Type.Object(typeboxProps, { description });
    }

    default:
      // For unknown types, use Unknown
      return Type.Unknown({ description });
  }
}

/**
 * Convert MCP tool input schema to TypeBox parameters schema.
 */
function convertInputSchema(inputSchema: Tool["inputSchema"]): TSchema {
  if (!inputSchema || typeof inputSchema !== "object") {
    return Type.Object({});
  }

  // MCP input schemas are typically JSON Schema objects
  return jsonSchemaToTypeBox(inputSchema as Record<string, unknown>);
}

/**
 * Format MCP tool result content for AgentTool response.
 */
function formatToolResult(result: unknown): string {
  if (!result || typeof result !== "object") {
    return String(result);
  }

  const typedResult = result as {
    content?: Array<{ type: string; text?: string; data?: string }>;
    isError?: boolean;
  };

  if (typedResult.content && Array.isArray(typedResult.content)) {
    return typedResult.content
      .map((item) => {
        if (item.type === "text" && item.text) {
          return item.text;
        }
        if (item.type === "image" && item.data) {
          return "[Image data]";
        }
        return JSON.stringify(item);
      })
      .join("\n");
  }

  return JSON.stringify(result, null, 2);
}

/**
 * Convert an MCP tool to an AgentTool.
 */
export function convertMCPToolToAgentTool(
  serverName: string,
  mcpTool: Tool,
  mcpClient: MCPClientManager
): AgentTool {
  // Create a unique name by prefixing with server name to avoid collisions
  const toolName = `mcp_${serverName}_${mcpTool.name}`;

  return {
    name: toolName,
    label: mcpTool.name,
    description: mcpTool.description ?? `MCP tool from ${serverName}`,
    parameters: convertInputSchema(mcpTool.inputSchema),
    execute: async (_toolCallId, params, _signal, onUpdate) => {
      const args = params as Record<string, unknown>;

      onUpdate?.({
        content: [{ type: "text", text: `Calling MCP tool: ${mcpTool.name}` }],
        details: { serverName, toolName: mcpTool.name, args },
      });

      try {
        const result = await mcpClient.callTool(serverName, mcpTool.name, args);

        const typedResult = result as { isError?: boolean };
        if (typedResult.isError) {
          throw new Error(formatToolResult(result));
        }

        const text = formatToolResult(result);

        return {
          content: [{ type: "text", text }],
          details: {
            serverName,
            toolName: mcpTool.name,
            success: true,
          },
        };
      } catch (error) {
        throw new Error(
          `MCP tool ${mcpTool.name} failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    },
  };
}

/**
 * Convert all MCP tools from the client manager to AgentTools.
 */
export function convertAllMCPTools(mcpClient: MCPClientManager): AgentTool[] {
  const mcpTools = mcpClient.getAllTools();

  return mcpTools.map(({ serverName, tool }) =>
    convertMCPToolToAgentTool(serverName, tool, mcpClient)
  );
}
