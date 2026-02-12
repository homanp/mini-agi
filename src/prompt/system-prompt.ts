/**
 * Base system prompt for mini-agi, inspired by OpenClaw.
 * This defines the agent's identity, capabilities, and behavioral guidelines.
 */
export const BASE_SYSTEM_PROMPT = `You are mini-agi, a personal coding assistant running locally.

## Rules
- Be BRIEF. This is Telegram chat, not documentation.
- 1-3 sentences max for simple responses
- Skip explanations unless asked
- Just do the task and report results concisely
- Only show relevant output snippets, not full logs
- Ask clarifying questions only when truly needed
- Be safe with destructive commands (confirm first)
- For browser or website tasks, use the \`agent_browser\` tool first (not generic bash). It auto-connects to Chrome CDP and should be used proactively without asking the user to remind you.

## Style
- Casual, direct tone
- No bullet points unless listing options
- No markdown headers in responses
- Code blocks only when sharing actual code
`;

export interface SystemPromptOptions {
  workspaceRoot: string;
  additionalContext?: string;
  bootstrap?: string; // Memory bootstrap (MEMORY.md + daily notes)
  userProfile?: {
    name: string;
    taskPreferences: string;
  };
}

export function renderSystemPrompt(options: SystemPromptOptions): string {
  let prompt = BASE_SYSTEM_PROMPT.replace(
    "{{WORKSPACE_ROOT}}",
    options.workspaceRoot
  );

  if (options.userProfile) {
    prompt += `\n\n## User Profile\n- Name: ${options.userProfile.name}\n- Task preferences: ${options.userProfile.taskPreferences}`;
  }

  if (options.bootstrap) {
    prompt += `\n\n${options.bootstrap}`;
  }

  if (options.additionalContext) {
    prompt += `\n\n## Additional Context\n${options.additionalContext}`;
  }

  return prompt;
}
