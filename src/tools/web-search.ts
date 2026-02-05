import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

export interface WebSearchOptions {
  apiKey: string;
}

interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
}

interface BraveWebSearchResponse {
  web?: {
    results: BraveSearchResult[];
  };
}

/**
 * Creates a web search tool using Brave Search API.
 * https://api.search.brave.com/app/documentation/web-search/get-started
 */
export function createWebSearchTool(options: WebSearchOptions): AgentTool {
  const { apiKey } = options;

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
    execute: async (_toolCallId, params, signal, onUpdate) => {
      const { query, max_results = 5 } = params as {
        query: string;
        max_results?: number;
      };

      onUpdate?.({
        content: [{ type: "text", text: `Searching: ${query}` }],
        details: { query },
      });

      try {
        const url = new URL("https://api.search.brave.com/res/v1/web/search");
        url.searchParams.set("q", query);
        url.searchParams.set("count", String(max_results));

        const response = await fetch(url.toString(), {
          method: "GET",
          headers: {
            Accept: "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": apiKey,
          },
          signal: signal ?? undefined,
        });

        if (!response.ok) {
          throw new Error(
            `Brave API error: ${response.status} ${response.statusText}`
          );
        }

        const data = (await response.json()) as BraveWebSearchResponse;
        const results = data.web?.results ?? [];

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: "No results found" }],
            details: { query, resultCount: 0 },
          };
        }

        const formatted = results
          .slice(0, max_results)
          .map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.description}`)
          .join("\n\n");

        return {
          content: [{ type: "text", text: formatted }],
          details: { query, resultCount: results.length },
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
