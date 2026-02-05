import { renderSystemPrompt, type SystemPromptOptions } from "./system-prompt";

export { BASE_SYSTEM_PROMPT, renderSystemPrompt } from "./system-prompt";
export type { SystemPromptOptions } from "./system-prompt.js";

/**
 * Build the complete system prompt for the agent.
 * This is the main entry point for prompt construction.
 */
export function buildSystemPrompt(options: SystemPromptOptions): string {
  return renderSystemPrompt(options);
}
