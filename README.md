# mini-agi

A slimmed-down local coding agent inspired by [OpenClaw](https://github.com/openclaw/openclaw). Runs entirely on your device with a Telegram bot interface.

## Features

- **Telegram Interface**: Chat with your agent via Telegram
- **pi-agent Core**: Powered by [@mariozechner/pi-agent-core](https://github.com/badlogic/pi-mono) for the agent loop
- **Bash Tool**: Execute shell commands in your workspace
- **Persistent Memory**: Conversation history saved across sessions
- **Local Execution**: Everything runs on your machine

## Prerequisites

- Bun >= 1.0
- A Telegram Bot Token (get one from [@BotFather](https://t.me/BotFather))
- An LLM API key (Anthropic, OpenAI, or Google)

## Quick Start

1. **Clone and install dependencies**

```bash
cd mini-agi
bun install
```

2. **Configure environment**

```bash
cp .env.example .env
# Edit .env with your tokens and settings
```

3. **Run the agent**

```bash
# Development mode (with hot reload)
bun run dev

# Or production
bun run start
```

4. **Chat with your bot on Telegram**

Send `/start` to your bot to begin!

## Configuration

All configuration is done via environment variables. See `.env.example` for all options.

### Required

- `TELEGRAM_BOT_TOKEN` - Your Telegram bot token
- `LLM_API_KEY` - Your LLM provider API key

### Optional

- `LLM_PROVIDER` - LLM provider: `anthropic`, `openai`, or `google` (default: `anthropic`)
- `LLM_MODEL` - Model name (default: `claude-sonnet-4-20250514`)
- `TELEGRAM_ALLOWED_USERS` - Comma-separated user IDs/usernames to allow (empty = allow all)
- `WORKSPACE_ROOT` - Root directory for file operations
- `MEMORY_DIR` - Directory for conversation logs
- `SESSION_DIR` - Directory for session transcripts

## Commands

- `/start` - Show welcome message
- `/reset` - Clear conversation history
- `/stop` - Abort current operation

## How Memory Works

mini-agi has two memory systems:

### Session Persistence (JSONL)
- Conversations stored as JSONL files in `SESSION_DIR`
- Restored on bot restart so the agent remembers context
- No re-greeting after restarts

### Memory Bootstrap
- On startup, loads `MEMORY.md` + today/yesterday's notes from `MEMORY_DIR`
- Injected into system prompt for long-term context
- Daily conversation logs saved as markdown files

To reset everything, send `/reset` in Telegram.

## Security

- Bash runs with real filesystem access in `WORKSPACE_ROOT`
- Dangerous commands (rm -rf /, etc.) are blocked
- Use `TELEGRAM_ALLOWED_USERS` to restrict access

## License

MIT
