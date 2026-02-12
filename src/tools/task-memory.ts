import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import {
  appendTaskMemory,
  completeTask,
  loadTasks,
  markTaskTouched,
  upsertTask,
  type TaskPriority,
  type TaskStatus,
} from "../memory/tasks";

export interface TaskMemoryToolOptions {
  memoryDir: string;
}

type TaskAction =
  | "create_task"
  | "update_task"
  | "append_note"
  | "complete_task"
  | "list_active_tasks";

function asStatus(value: unknown): TaskStatus | undefined {
  if (value === "active" || value === "blocked" || value === "completed") {
    return value;
  }
  return undefined;
}

function asPriority(value: unknown): TaskPriority | undefined {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return undefined;
}

export function createTaskMemoryTool(options: TaskMemoryToolOptions): AgentTool {
  const { memoryDir } = options;

  return {
    name: "task_memory",
    label: "Task Memory",
    description:
      "Track long-running user tasks in persistent markdown memory. Create tasks, update status/summary, append progress notes, complete tasks, and list active tasks.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("create_task"),
        Type.Literal("update_task"),
        Type.Literal("append_note"),
        Type.Literal("complete_task"),
        Type.Literal("list_active_tasks"),
      ]),
      user_id: Type.String({
        description: "Current user id from conversation context",
      }),
      task_id: Type.Optional(
        Type.String({
          description: "Task id for update/note/complete actions",
        })
      ),
      title: Type.Optional(
        Type.String({
          description: "Task title",
        })
      ),
      status: Type.Optional(
        Type.String({
          description: "Task status: active, blocked, completed",
        })
      ),
      priority: Type.Optional(
        Type.String({
          description: "Task priority: low, medium, high",
        })
      ),
      summary: Type.Optional(
        Type.String({
          description: "Concise task summary",
        })
      ),
      note: Type.Optional(
        Type.String({
          description: "Progress note to append to task markdown",
        })
      ),
    }),
    execute: async (_toolCallId, params, _signal, onUpdate) => {
      const {
        action,
        user_id,
        task_id,
        title,
        status,
        priority,
        summary,
        note,
      } = params as {
        action: TaskAction;
        user_id: string;
        task_id?: string;
        title?: string;
        status?: string;
        priority?: string;
        summary?: string;
        note?: string;
      };

      if (!user_id?.trim()) {
        throw new Error("task_memory requires user_id");
      }

      onUpdate?.({
        content: [{ type: "text", text: `Task op: ${action}` }],
        details: { action, userId: user_id, taskId: task_id ?? null },
      });

      if (action === "create_task") {
        if (!title?.trim()) {
          throw new Error("create_task requires title");
        }
        const task = await upsertTask(memoryDir, {
          userId: user_id,
          title: title.trim(),
          summary: summary?.trim() || "",
          priority: asPriority(priority) ?? "medium",
          status: asStatus(status) ?? "active",
        });
        markTaskTouched(user_id, task.taskId, "create_task");
        if (note?.trim()) {
          await appendTaskMemory(memoryDir, user_id, task.taskId, note.trim());
        }
        return {
          content: [
            {
              type: "text",
              text: `Created task ${task.taskId}: ${task.title}`,
            },
          ],
          details: { action, task },
        };
      }

      if (action === "update_task") {
        if (!task_id?.trim()) {
          throw new Error("update_task requires task_id");
        }
        const task = await upsertTask(memoryDir, {
          userId: user_id,
          taskId: task_id.trim(),
          title: title?.trim(),
          summary: summary?.trim(),
          priority: asPriority(priority),
          status: asStatus(status),
        });
        markTaskTouched(user_id, task.taskId, "update_task");
        if (note?.trim()) {
          await appendTaskMemory(memoryDir, user_id, task.taskId, note.trim());
        }
        return {
          content: [
            { type: "text", text: `Updated task ${task.taskId}: ${task.title}` },
          ],
          details: { action, task },
        };
      }

      if (action === "append_note") {
        if (!task_id?.trim()) {
          throw new Error("append_note requires task_id");
        }
        if (!note?.trim()) {
          throw new Error("append_note requires note");
        }
        const task = await upsertTask(memoryDir, {
          userId: user_id,
          taskId: task_id.trim(),
        });
        await appendTaskMemory(memoryDir, user_id, task.taskId, note.trim());
        markTaskTouched(user_id, task.taskId, "append_note");
        return {
          content: [
            { type: "text", text: `Appended note to task ${task.taskId}` },
          ],
          details: { action, taskId: task.taskId },
        };
      }

      if (action === "complete_task") {
        if (!task_id?.trim()) {
          throw new Error("complete_task requires task_id");
        }
        const task = await completeTask(
          memoryDir,
          user_id,
          task_id.trim(),
          summary?.trim()
        );
        markTaskTouched(user_id, task.taskId, "complete_task");
        if (note?.trim()) {
          await appendTaskMemory(memoryDir, user_id, task.taskId, note.trim());
        }
        return {
          content: [{ type: "text", text: `Completed task ${task.taskId}` }],
          details: { action, task },
        };
      }

      if (action === "list_active_tasks") {
        const tasks = (await loadTasks(memoryDir, user_id)).filter(
          (task) => task.status !== "completed"
        );
        const text =
          tasks.length === 0
            ? "No active tasks."
            : tasks
                .map(
                  (task, idx) =>
                    `${idx + 1}. ${task.title} (${task.taskId}) [${task.status}]`
                )
                .join("\n");
        return {
          content: [{ type: "text", text }],
          details: { action, count: tasks.length },
        };
      }

      throw new Error(`Unsupported action: ${action}`);
    },
  };
}
