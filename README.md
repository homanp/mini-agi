# mini-agi

My personal autonomous mini-me. A little AI buddy that lives on my computer, chats with me on Telegram, and helps get things done.

## What it does

- Runs shell commands on my machine
- Searches the web when it needs fresh info
- Remembers our conversations across sessions
- Learns my preferences over time

## Setup

1. Clone it
2. `bun install`
3. Copy `.env.example` to `.env` and add your keys
4. `bun run dev`

Then find it on Telegram and start chatting.

## Browser automation (agent-browser + real Chrome)

This project uses `agent-browser` directly from shell commands (no MCP wrapper required for browser control).

1. Install once:
   - `npm install -g agent-browser`
   - `agent-browser install`
2. Launch your real Chrome with remote debugging enabled:
   - `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222`
3. Run browser commands against that Chrome session:
   - `agent-browser connect 9222`
   - `agent-browser open http://localhost:3000`
   - `agent-browser snapshot -i --json`
   - `agent-browser click @e2`
   - `agent-browser fill @e3 "text"`

Notes:
- CDP mode uses your existing Chrome profile (cookies/sessions/extensions).
- Since this is your actual Chrome window, actions are visible (headed).

### Automatic behavior in mini-agi

mini-agi now includes a dedicated `agent_browser` tool and is prompted to use it first for browser tasks automatically.

- It auto-targets Chrome CDP on port `9222`.
- If CDP is not available, it tries to launch Chrome with `--remote-debugging-port=9222`.
- On macOS, if Chrome is already running without CDP, it can automatically restart Chrome and relaunch with remote debugging enabled.
- It then runs `agent-browser --cdp 9222 ...` for navigation/interactions.

Optional env vars:
- `AGENT_BROWSER_CDP_PORT` (default: `9222`)
- `AGENT_BROWSER_AUTO_LAUNCH_CHROME` (default: `true`)
- `AGENT_BROWSER_AUTO_RESTART_CHROME_FOR_CDP` (default: `true`, macOS)
- `AGENT_BROWSER_AUTO_BOOTSTRAP_PROFILE` (default: `true`, auto-copies missing named profile into CDP user-data-dir)
- `AGENT_BROWSER_USE_REGULAR_PROFILE` (default: `true`, reuse your normal Chrome profile/session)
- `AGENT_BROWSER_CHROME_PROFILE_NAME` (default: `picobot`, resolves by Chrome profile display name)
- `AGENT_BROWSER_CHROME_USER_DATA_DIR` (optional override for Chrome User Data path)
- `AGENT_BROWSER_CHROME_PROFILE_DIRECTORY` (optional profile name, e.g. `Default`, `Profile 1`)
- `AGENT_BROWSER_CHROME_BINARY` (default: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`)

## Long-running task memory

mini-agi now keeps persistent multi-task state automatically from natural language (no `/task` commands needed).

- Active task index: `memory/tasks-{userId}.json`
- Per-task memory markdown: `memory/tasks/{userId}/{taskId}.md`
- Task tool used by the agent: `task_memory` (`create_task`, `update_task`, `append_note`, `complete_task`, `list_active_tasks`)

How it works:
- On each user message, mini-agi loads active tasks and injects them into the system prompt.
- During execution, the agent updates task state through `task_memory`.
- After a response, a concise progress note is appended to touched task markdown files.

Optional env vars:
- `ACTIVE_TASKS_CONTEXT_MAX_CHARS` (default: `3000`)
- `ACTIVE_TASKS_CONTEXT_MAX_ITEMS` (default: `8`)

## License

MIT
