import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface BashToolOptions {
  workspaceRoot: string;
  /** Commands that are never allowed (security) */
  blockedCommands?: string[];
  /** Maximum execution time in ms */
  timeout?: number;
}

const DEFAULT_BLOCKED_COMMANDS = [
  "rm -rf /",
  "rm -rf /*",
  "mkfs",
  "dd if=/dev/zero",
  ":(){ :|:& };:",
  "> /dev/sda",
];

/**
 * Creates a bash tool that executes commands in the configured workspace.
 * Uses Node's native child_process for real filesystem access.
 */
export function createBashTool(options: BashToolOptions): AgentTool {
  const {
    workspaceRoot,
    blockedCommands = DEFAULT_BLOCKED_COMMANDS,
    timeout = 30000,
  } = options;

  function isBlocked(command: string): boolean {
    const normalized = command.toLowerCase().trim();
    return blockedCommands.some((blocked) =>
      normalized.includes(blocked.toLowerCase())
    );
  }

  return {
    name: "bash",
    label: "Execute Bash",
    description: `Execute bash commands in the workspace at ${workspaceRoot}. Use this for file operations, running scripts, and system commands.`,
    parameters: Type.Object({
      command: Type.String({
        description: "The bash command to execute",
      }),
    }),
    execute: async (_toolCallId, params, signal, onUpdate) => {
      const { command } = params as { command: string };

      // Security check
      if (isBlocked(command)) {
        throw new Error(`Command blocked for security reasons: ${command}`);
      }

      onUpdate?.({
        content: [{ type: "text", text: `Executing: ${command}` }],
        details: { command },
      });

      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: workspaceRoot,
          timeout,
          maxBuffer: 10 * 1024 * 1024, // 10MB
          signal: signal ?? undefined,
        });

        const output = [
          stdout ? `stdout:\n${stdout}` : "",
          stderr ? `stderr:\n${stderr}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        return {
          content: [{ type: "text", text: output || "(no output)" }],
          details: {
            command,
            hasStdout: Boolean(stdout),
            hasStderr: Boolean(stderr),
          },
        };
      } catch (error) {
        const err = error as {
          code?: number;
          stdout?: string;
          stderr?: string;
          message?: string;
        };

        // If there's output even with error, include it
        const output = [
          err.stdout ? `stdout:\n${err.stdout}` : "",
          err.stderr ? `stderr:\n${err.stderr}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        throw new Error(
          `Command failed${err.code ? ` with exit code ${err.code}` : ""}\n${
            output || err.message
          }`
        );
      }
    },
  };
}
