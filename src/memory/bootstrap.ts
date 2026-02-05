import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Safely reads a file, returning empty string if it doesn't exist.
 */
async function safeReadFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Gets yesterday's date as YYYY-MM-DD string.
 */
function getYesterdayDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Gets today's date as YYYY-MM-DD string.
 */
function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface BootstrapOptions {
  memoryDir: string;
  maxLength?: number; // Truncate if too long
}

/**
 * Loads memory bootstrap content from:
 * - MEMORY.md (long-term curated memory)
 * - Today's daily notes (YYYY-MM-DD.md)
 * - Yesterday's daily notes
 *
 * Returns a formatted string to inject into the system prompt.
 */
export async function loadMemoryBootstrap(
  options: BootstrapOptions
): Promise<string> {
  const { memoryDir, maxLength = 8000 } = options;

  const memoryPath = path.join(memoryDir, "MEMORY.md");
  const todayPath = path.join(memoryDir, `${getTodayDate()}.md`);
  const yesterdayPath = path.join(memoryDir, `${getYesterdayDate()}.md`);

  const [memory, today, yesterday] = await Promise.all([
    safeReadFile(memoryPath),
    safeReadFile(todayPath),
    safeReadFile(yesterdayPath),
  ]);

  const sections: string[] = [];

  if (memory.trim()) {
    sections.push(`### Long-term Memory\n${memory.trim()}`);
  }

  if (yesterday.trim()) {
    sections.push(`### Yesterday's Notes (${getYesterdayDate()})\n${yesterday.trim()}`);
  }

  if (today.trim()) {
    sections.push(`### Today's Notes (${getTodayDate()})\n${today.trim()}`);
  }

  if (sections.length === 0) {
    return "";
  }

  let result = `## Memory Context\n\n${sections.join("\n\n")}`;

  // Truncate if too long to avoid context bloat
  if (result.length > maxLength) {
    result = result.slice(0, maxLength) + "\n\n... (memory truncated)";
  }

  return result;
}
