import { promises as fs } from "node:fs";
import path from "node:path";

export type TaskStatus = "active" | "blocked" | "completed";
export type TaskPriority = "low" | "medium" | "high";

export interface TaskRecord {
  taskId: string;
  userId: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  summary: string;
  createdAt: string;
  updatedAt: string;
  lastWorkedAt: string;
}

export interface TaskTouch {
  taskId: string;
  action: "create_task" | "update_task" | "append_note" | "complete_task";
  touchedAt: string;
}

const recentTaskTouches = new Map<string, Map<string, TaskTouch>>();

function tasksIndexPath(memoryDir: string, userId: string): string {
  return path.join(memoryDir, `tasks-${userId}.json`);
}

function taskMemoryDir(memoryDir: string, userId: string): string {
  return path.join(memoryDir, "tasks", userId);
}

export function taskMemoryPath(
  memoryDir: string,
  userId: string,
  taskId: string
): string {
  return path.join(taskMemoryDir(memoryDir, userId), `${taskId}.md`);
}

function nowIso(): string {
  return new Date().toISOString();
}

function generateTaskId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `task_${ts}_${rand}`;
}

async function ensureTaskStorage(
  memoryDir: string,
  userId: string
): Promise<void> {
  await fs.mkdir(taskMemoryDir(memoryDir, userId), { recursive: true });
}

export async function loadTasks(
  memoryDir: string,
  userId: string
): Promise<TaskRecord[]> {
  const filePath = tasksIndexPath(memoryDir, userId);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as TaskRecord[];
    return parsed
      .filter(
        (t) =>
          typeof t.taskId === "string" &&
          typeof t.userId === "string" &&
          typeof t.title === "string" &&
          typeof t.status === "string"
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

async function saveTasks(
  memoryDir: string,
  userId: string,
  tasks: TaskRecord[]
): Promise<void> {
  await ensureTaskStorage(memoryDir, userId);
  const filePath = tasksIndexPath(memoryDir, userId);
  await fs.writeFile(filePath, JSON.stringify(tasks, null, 2), "utf-8");
}

function formatTaskMemoryBlock(title: string, body: string, timestamp: string): string {
  return [
    `## ${timestamp}`,
    `### ${title}`,
    body,
    "",
    "---",
    "",
  ].join("\n");
}

async function ensureTaskMemoryFile(
  memoryDir: string,
  userId: string,
  task: TaskRecord
): Promise<void> {
  await ensureTaskStorage(memoryDir, userId);
  const mdPath = taskMemoryPath(memoryDir, userId, task.taskId);
  try {
    await fs.access(mdPath);
  } catch {
    const header = [
      `# ${task.title}`,
      "",
      `- Task ID: ${task.taskId}`,
      `- Status: ${task.status}`,
      `- Priority: ${task.priority}`,
      `- Created: ${task.createdAt}`,
      "",
      "## Task Summary",
      task.summary || "(no summary yet)",
      "",
      "---",
      "",
    ].join("\n");
    await fs.writeFile(mdPath, header, "utf-8");
  }
}

export async function appendTaskMemory(
  memoryDir: string,
  userId: string,
  taskId: string,
  block: string
): Promise<void> {
  const tasks = await loadTasks(memoryDir, userId);
  const task = tasks.find((t) => t.taskId === taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  await ensureTaskMemoryFile(memoryDir, userId, task);
  const mdPath = taskMemoryPath(memoryDir, userId, taskId);
  const ts = nowIso();
  const formatted = formatTaskMemoryBlock("Progress Note", block.trim(), ts);
  await fs.appendFile(mdPath, formatted, "utf-8");
}

export interface UpsertTaskInput {
  userId: string;
  taskId?: string;
  title?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  summary?: string;
}

export async function upsertTask(
  memoryDir: string,
  input: UpsertTaskInput
): Promise<TaskRecord> {
  const { userId } = input;
  const tasks = await loadTasks(memoryDir, userId);
  const timestamp = nowIso();
  let task: TaskRecord | undefined;

  if (input.taskId) {
    task = tasks.find((t) => t.taskId === input.taskId);
  }

  if (!task) {
    task = {
      taskId: input.taskId ?? generateTaskId(),
      userId,
      title: input.title?.trim() || "Untitled task",
      status: input.status ?? "active",
      priority: input.priority ?? "medium",
      summary: input.summary?.trim() || "",
      createdAt: timestamp,
      updatedAt: timestamp,
      lastWorkedAt: timestamp,
    };
    tasks.push(task);
  } else {
    if (input.title?.trim()) task.title = input.title.trim();
    if (input.status) task.status = input.status;
    if (input.priority) task.priority = input.priority;
    if (input.summary !== undefined) task.summary = input.summary.trim();
    task.updatedAt = timestamp;
    task.lastWorkedAt = timestamp;
  }

  await saveTasks(memoryDir, userId, tasks);
  await ensureTaskMemoryFile(memoryDir, userId, task);
  return task;
}

export async function completeTask(
  memoryDir: string,
  userId: string,
  taskId: string,
  completionSummary?: string
): Promise<TaskRecord> {
  const task = await upsertTask(memoryDir, {
    userId,
    taskId,
    status: "completed",
    summary: completionSummary,
  });
  await appendTaskMemory(
    memoryDir,
    userId,
    taskId,
    completionSummary?.trim()
      ? `Marked completed.\n\n${completionSummary.trim()}`
      : "Marked completed."
  );
  return task;
}

export function markTaskTouched(
  userId: string,
  taskId: string,
  action: TaskTouch["action"]
): void {
  const byUser = recentTaskTouches.get(userId) ?? new Map<string, TaskTouch>();
  byUser.set(taskId, {
    taskId,
    action,
    touchedAt: nowIso(),
  });
  recentTaskTouches.set(userId, byUser);
}

export function consumeTaskTouches(userId: string): TaskTouch[] {
  const byUser = recentTaskTouches.get(userId);
  if (!byUser) return [];
  recentTaskTouches.delete(userId);
  return Array.from(byUser.values()).sort((a, b) =>
    b.touchedAt.localeCompare(a.touchedAt)
  );
}

export async function summarizeActiveTasksForPrompt(
  memoryDir: string,
  userId: string,
  limitChars = 3000,
  maxTasks = 8
): Promise<string> {
  const tasks = (await loadTasks(memoryDir, userId))
    .filter((t) => t.status !== "completed")
    .sort((a, b) => b.lastWorkedAt.localeCompare(a.lastWorkedAt))
    .slice(0, Math.max(1, maxTasks));

  if (tasks.length === 0) {
    return "No active tasks yet.";
  }

  const lines = tasks.map((task, idx) => {
    const summary = task.summary?.trim() || "No summary yet.";
    return `${idx + 1}. [${task.status}] ${task.title} (id: ${
      task.taskId
    }, priority: ${task.priority})\n   Summary: ${summary}`;
  });

  let text = lines.join("\n");
  if (text.length > limitChars) {
    text = text.slice(0, limitChars) + "\n... (active tasks truncated)";
  }
  return text;
}
