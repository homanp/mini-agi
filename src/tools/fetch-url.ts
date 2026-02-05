import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

export interface FetchUrlOptions {
  /** Maximum content length in characters (default: 50000) */
  maxLength?: number;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

/**
 * Strips HTML tags and extracts text content.
 */
function htmlToText(html: string): string {
  return (
    html
      // Remove script and style elements entirely
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      // Remove HTML comments
      .replace(/<!--[\s\S]*?-->/g, "")
      // Replace common block elements with newlines
      .replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote|pre|hr)[^>]*>/gi, "\n")
      // Remove all remaining HTML tags
      .replace(/<[^>]+>/g, "")
      // Decode common HTML entities
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // Collapse multiple whitespace/newlines
      .replace(/\n\s*\n/g, "\n\n")
      .replace(/[ \t]+/g, " ")
      .trim()
  );
}

/**
 * Creates a tool that fetches content from a URL and returns it as text.
 */
export function createFetchUrlTool(options: FetchUrlOptions = {}): AgentTool {
  const { maxLength = 50000, timeout = 30000 } = options;

  return {
    name: "fetch_url",
    label: "Fetch URL",
    description:
      "Fetch the content of a web page and return it as text. Use this to read the full content of a URL found via web search.",
    parameters: Type.Object({
      url: Type.String({
        description: "The URL to fetch",
      }),
    }),
    execute: async (_toolCallId, params, signal, onUpdate) => {
      const { url } = params as { url: string };

      onUpdate?.({
        content: [{ type: "text", text: `Fetching: ${url}` }],
        details: { url },
      });

      try {
        // Validate URL
        const parsedUrl = new URL(url);
        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
          throw new Error("Only HTTP and HTTPS URLs are supported");
        }

        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        // Combine with external signal if provided
        if (signal) {
          signal.addEventListener("abort", () => controller.abort());
        }

        try {
          const response = await fetch(url, {
            method: "GET",
            headers: {
              "User-Agent":
                "Mozilla/5.0 (compatible; mini-agi/1.0; +https://github.com)",
              Accept: "text/html,application/xhtml+xml,text/plain,*/*",
            },
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const contentType = response.headers.get("content-type") || "";
          const html = await response.text();

          // Extract text from HTML
          let text: string;
          if (
            contentType.includes("text/html") ||
            contentType.includes("application/xhtml")
          ) {
            text = htmlToText(html);
          } else {
            // For plain text or other formats, use as-is
            text = html;
          }

          // Truncate if too long
          const truncated = text.length > maxLength;
          if (truncated) {
            text = text.slice(0, maxLength) + "\n\n[Content truncated...]";
          }

          return {
            content: [{ type: "text", text }],
            details: {
              url,
              contentType,
              originalLength: html.length,
              textLength: text.length,
              truncated,
            },
          };
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`Request timed out after ${timeout}ms`);
        }
        throw new Error(
          `Failed to fetch URL: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    },
  };
}
