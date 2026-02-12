import { promises as fs } from "node:fs";
import path from "node:path";

export interface TranscriptEntry {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

function getTranscriptPath(sessionDir: string, userId: string): string {
  return path.join(sessionDir, `${userId}.jsonl`);
}

export async function ensureSessionDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function loadTranscript(
  sessionDir: string,
  userId: string
): Promise<TranscriptEntry[]> {
  const filePath = getTranscriptPath(sessionDir, userId);

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parsed = JSON.parse(line) as Partial<TranscriptEntry>;
        if (
          (parsed.role !== "user" && parsed.role !== "assistant") ||
          typeof parsed.content !== "string" ||
          typeof parsed.timestamp !== "number"
        ) {
          throw new Error("Invalid transcript line");
        }
        return {
          role: parsed.role,
          content: parsed.content,
          timestamp: parsed.timestamp,
        };
      });
  } catch {
    return [];
  }
}

export async function appendTranscript(
  sessionDir: string,
  userId: string,
  entries: TranscriptEntry[]
): Promise<void> {
  if (entries.length === 0) return;

  const filePath = getTranscriptPath(sessionDir, userId);
  const lines = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  await fs.appendFile(filePath, lines, "utf-8");
}

export async function clearTranscript(
  sessionDir: string,
  userId: string
): Promise<void> {
  const filePath = getTranscriptPath(sessionDir, userId);
  try {
    await fs.unlink(filePath);
  } catch {
    // Ignore if transcript does not exist.
  }
}
