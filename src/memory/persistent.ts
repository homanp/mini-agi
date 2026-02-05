import { promises as fs } from "node:fs";
import path from "node:path";

export interface MemoryEntry {
  userId: string;
  userMessage: string;
  assistantMessage: string;
  timestamp: string;
}

export async function ensureMemoryDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function appendMemoryEntry(
  dir: string,
  entry: MemoryEntry
): Promise<void> {
  const date = new Date(entry.timestamp);
  const day = date.toISOString().slice(0, 10);
  const filePath = path.join(dir, `${day}.md`);
  const block = [
    `## ${date.toISOString()}`,
    `**User (${entry.userId})**:`,
    entry.userMessage,
    "",
    "**Assistant**:",
    entry.assistantMessage,
    "",
    "---",
    "",
  ].join("\n");

  await fs.appendFile(filePath, block, "utf-8");
}
