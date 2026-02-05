import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import Parallel from "parallel-web";

export interface WebSearchOptions {
  apiKey: string;
}

export function createWebSearchTool(options: WebSearchOptions): AgentTool {
  const client = new Parallel({ apiKey: options.apiKey });

  return {
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web for current information. Use this when you need up-to-date info, news, or facts you don't know.",
    parameters: Type.Object({
      query: Type.String({
        description: "What to search for",
      }),
      max_results: Type.Optional(
        Type.Number({
          description: "Max number of results (default: 5)",
        })
      ),
    }),
    execute: async (_toolCallId, params, _signal, onUpdate) => {
      const { query, max_results = 5 } = params as {
        query: string;
        max_results?: number;
      };

      onUpdate?.({
        content: [{ type: "text", text: `Searching: ${query}` }],
        details: { query },
      });

      try {
        const search = await client.beta.search({
          objective: query,
          search_queries: [query],
          max_results,
          max_chars_per_result: 2000,
        });

        if (!search.results || search.results.length === 0) {
          return {
            content: [{ type: "text", text: "No results found" }],
            details: { query, resultCount: 0 },
          };
        }

        const formatted = search.results
          .map(
            (r: any, i: number) =>
              `${i + 1}. ${r.title || "No title"}\n${r.url || ""}\n${
                r.content || r.snippet || ""
              }`
          )
          .join("\n\n");

        return {
          content: [{ type: "text", text: formatted }],
          details: { query, resultCount: search.results.length },
        };
      } catch (error) {
        throw new Error(
          `Search failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    },
  };
}
