import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import net from "node:net";

const execFileAsync = promisify(execFile);

export interface AgentBrowserToolOptions {
  workspaceRoot: string;
  timeout?: number;
  cdpPort?: number;
  autoLaunchChrome?: boolean;
  autoRestartChromeForCdp?: boolean;
  autoBootstrapProfile?: boolean;
  chromeBinaryPath?: string;
  useRegularChromeProfile?: boolean;
  chromeUserDataDir?: string;
  chromeProfileDirectory?: string;
  chromeProfileName?: string;
}

const DEFAULT_CHROME_BINARY_PATH =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function isPortOpen(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.setTimeout(500);
    socket.once("connect", () => {
      cleanup();
      resolve(true);
    });
    socket.once("timeout", () => {
      cleanup();
      resolve(false);
    });
    socket.once("error", () => {
      cleanup();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

async function waitForPortOpen(
  port: number,
  timeoutMs = 10000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function getDefaultChromeUserDataDir(): string | null {
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library/Application Support/Google/Chrome");
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) return null;
    return path.join(localAppData, "Google/Chrome/User Data");
  }
  return null;
}

function getMainChromeUserDataDir(): string | null {
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library/Application Support/Google/Chrome");
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) return null;
    return path.join(localAppData, "Google/Chrome/User Data");
  }
  return null;
}

async function detectLastUsedChromeProfile(
  userDataDir: string
): Promise<string | null> {
  const localStatePath = path.join(userDataDir, "Local State");
  try {
    const raw = await fs.readFile(localStatePath, "utf-8");
    const parsed = JSON.parse(raw) as { profile?: { last_used?: string } };
    return parsed.profile?.last_used ?? null;
  } catch {
    return null;
  }
}

async function detectProfileDirectoryByName(
  userDataDir: string,
  profileName: string
): Promise<string | null> {
  const localStatePath = path.join(userDataDir, "Local State");
  try {
    const raw = await fs.readFile(localStatePath, "utf-8");
    const parsed = JSON.parse(raw) as {
      profile?: {
        info_cache?: Record<string, { name?: string }>;
      };
    };
    const infoCache = parsed.profile?.info_cache ?? {};
    const normalizedTarget = profileName.trim().toLowerCase();
    for (const [directoryName, meta] of Object.entries(infoCache)) {
      if ((meta?.name ?? "").trim().toLowerCase() === normalizedTarget) {
        return directoryName;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function readLocalState(
  userDataDir: string
): Promise<Record<string, unknown> | null> {
  const localStatePath = path.join(userDataDir, "Local State");
  try {
    const raw = await fs.readFile(localStatePath, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function writeLocalState(
  userDataDir: string,
  value: Record<string, unknown>
): Promise<void> {
  const localStatePath = path.join(userDataDir, "Local State");
  await fs.mkdir(userDataDir, { recursive: true });
  await fs.writeFile(localStatePath, JSON.stringify(value), "utf-8");
}

type ProfileInfoCache = Record<string, { name?: string }>;

function ensureProfileInfoOnState(
  state: Record<string, unknown>,
  profileDirectory: string,
  profileName: string
): Record<string, unknown> {
  const profile =
    typeof state.profile === "object" && state.profile !== null
      ? (state.profile as Record<string, unknown>)
      : {};
  const infoCache =
    typeof profile.info_cache === "object" && profile.info_cache !== null
      ? (profile.info_cache as ProfileInfoCache)
      : {};

  const existing = infoCache[profileDirectory] ?? {};
  infoCache[profileDirectory] = {
    ...existing,
    name: existing.name || profileName,
  };
  profile.info_cache = infoCache;
  profile.last_used = profileDirectory;

  const profilesOrder = Array.isArray(profile.profiles_order)
    ? (profile.profiles_order as unknown[]).filter(
        (v): v is string => typeof v === "string"
      )
    : [];
  if (!profilesOrder.includes(profileDirectory)) {
    profilesOrder.push(profileDirectory);
  }
  profile.profiles_order = profilesOrder;

  return {
    ...state,
    profile,
  };
}

async function bootstrapProfileToUserDataDir(options: {
  sourceUserDataDir: string;
  targetUserDataDir: string;
  profileDirectory: string;
  profileName: string;
}): Promise<void> {
  const {
    sourceUserDataDir,
    targetUserDataDir,
    profileDirectory,
    profileName,
  } = options;
  if (sourceUserDataDir === targetUserDataDir) {
    return;
  }

  const sourceProfilePath = path.join(sourceUserDataDir, profileDirectory);
  const targetProfilePath = path.join(targetUserDataDir, profileDirectory);
  await fs.mkdir(targetUserDataDir, { recursive: true });

  try {
    await fs.access(targetProfilePath);
  } catch {
    await fs.cp(sourceProfilePath, targetProfilePath, { recursive: true });
  }

  const sourceState = (await readLocalState(sourceUserDataDir)) ?? {};
  const targetState = (await readLocalState(targetUserDataDir)) ?? {};
  const sourceProfileObj =
    typeof sourceState.profile === "object" && sourceState.profile !== null
      ? (sourceState.profile as Record<string, unknown>)
      : {};
  const sourceInfoCache =
    typeof sourceProfileObj.info_cache === "object" &&
    sourceProfileObj.info_cache !== null
      ? (sourceProfileObj.info_cache as ProfileInfoCache)
      : {};
  const sourceProfileName =
    sourceInfoCache[profileDirectory]?.name?.trim() || profileName;

  const merged = ensureProfileInfoOnState(
    targetState,
    profileDirectory,
    sourceProfileName
  );
  await writeLocalState(targetUserDataDir, merged);
}

function launchChromeWithCdp(
  chromeBinaryPath: string,
  cdpPort: number,
  workspaceRoot: string,
  launchArgs: string[]
): void {
  const child = spawn(chromeBinaryPath, launchArgs, {
    cwd: workspaceRoot,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function restartChromeForCdp(cdpPort: number): Promise<void> {
  if (process.platform !== "darwin") {
    return;
  }

  try {
    await execFileAsync("osascript", [
      "-e",
      'tell application "Google Chrome" to quit',
    ]);
  } catch {
    // Ignore if AppleScript quit is unavailable/fails.
  }

  try {
    await execFileAsync("pkill", ["-x", "Google Chrome"]);
  } catch {
    // Ignore if process not found.
  }

  await new Promise((r) => setTimeout(r, 1000));
}

function parseCliArgs(input: string): string[] {
  // Minimal shell-like parser for quotes and escapes.
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const ch of input) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (escaped) current += "\\";
  if (current.length > 0) args.push(current);
  return args;
}

export function createAgentBrowserTool(
  options: AgentBrowserToolOptions
): AgentTool {
  const {
    workspaceRoot,
    timeout = 30000,
    cdpPort = Number(process.env.AGENT_BROWSER_CDP_PORT ?? "9222"),
    autoLaunchChrome = (process.env.AGENT_BROWSER_AUTO_LAUNCH_CHROME ?? "true") ===
      "true",
    autoRestartChromeForCdp =
      (process.env.AGENT_BROWSER_AUTO_RESTART_CHROME_FOR_CDP ?? "true") ===
      "true",
    autoBootstrapProfile =
      (process.env.AGENT_BROWSER_AUTO_BOOTSTRAP_PROFILE ?? "true") === "true",
    chromeBinaryPath =
      process.env.AGENT_BROWSER_CHROME_BINARY ?? DEFAULT_CHROME_BINARY_PATH,
    useRegularChromeProfile =
      (process.env.AGENT_BROWSER_USE_REGULAR_PROFILE ?? "true") === "true",
    chromeUserDataDir =
      process.env.AGENT_BROWSER_CHROME_USER_DATA_DIR ??
      getDefaultChromeUserDataDir() ??
      undefined,
    chromeProfileDirectory = process.env.AGENT_BROWSER_CHROME_PROFILE_DIRECTORY,
    chromeProfileName = process.env.AGENT_BROWSER_CHROME_PROFILE_NAME ?? "picobot",
  } = options;

  return {
    name: "agent_browser",
    label: "Agent Browser",
    description:
      "Control real Chrome through agent-browser CLI. Use for website interaction, navigation, snapshots, clicking, typing, and screenshots. This tool auto-connects to CDP on port 9222, auto-launches/restarts Chrome when needed, and should be attempted before asking the user to manually start Chrome.",
    parameters: Type.Object({
      args: Type.String({
        description:
          'Arguments passed to agent-browser, without the binary name. Examples: \'open https://example.com\', \'snapshot -i --json\', \'click @e2\'.',
      }),
    }),
    execute: async (_toolCallId, params, signal, onUpdate) => {
      const { args } = params as { args: string };
      const cliArgs = parseCliArgs(args);
      if (cliArgs.length === 0) {
        throw new Error("agent_browser requires non-empty args");
      }

      onUpdate?.({
        content: [
          {
            type: "text",
            text: `Preparing browser on CDP port ${cdpPort}...`,
          },
        ],
        details: {
          cdpPort,
          cliArgs,
          useRegularChromeProfile,
          chromeUserDataDir: chromeUserDataDir ?? null,
          chromeProfileDirectory: chromeProfileDirectory ?? null,
        },
      });

      let resolvedProfileDirectory = chromeProfileDirectory;
      if (useRegularChromeProfile && chromeUserDataDir) {
        const byName = chromeProfileName?.trim()
          ? await detectProfileDirectoryByName(chromeUserDataDir, chromeProfileName)
          : null;
        if (byName) {
          resolvedProfileDirectory = byName;
        }

        if (!byName && autoBootstrapProfile && chromeProfileName?.trim()) {
          const mainUserDataDir = getMainChromeUserDataDir();
          if (mainUserDataDir) {
            const sourceByName = await detectProfileDirectoryByName(
              mainUserDataDir,
              chromeProfileName
            );
            if (sourceByName) {
              onUpdate?.({
                content: [
                  {
                    type: "text",
                    text: `Bootstrapping Chrome profile "${chromeProfileName}" into CDP user data dir...`,
                  },
                ],
                details: {
                  profileName: chromeProfileName,
                  sourceDirectory: sourceByName,
                  targetUserDataDir: chromeUserDataDir,
                },
              });
              await bootstrapProfileToUserDataDir({
                sourceUserDataDir: mainUserDataDir,
                targetUserDataDir: chromeUserDataDir,
                profileDirectory: sourceByName,
                profileName: chromeProfileName,
              });
              resolvedProfileDirectory = sourceByName;
            }
          }
        }

        if (!resolvedProfileDirectory) {
          resolvedProfileDirectory =
            byName ||
            chromeProfileDirectory ||
            (await detectLastUsedChromeProfile(chromeUserDataDir)) ||
            "Default";
        }
      }

      const launchArgs = [`--remote-debugging-port=${cdpPort}`];
      if (useRegularChromeProfile && chromeUserDataDir) {
        launchArgs.push(`--user-data-dir=${chromeUserDataDir}`);
        if (resolvedProfileDirectory) {
          launchArgs.push(`--profile-directory=${resolvedProfileDirectory}`);
        }
      }
      launchArgs.push("--no-first-run", "--no-default-browser-check");

      if (!(await isPortOpen(cdpPort))) {
        if (!autoLaunchChrome) {
          throw new Error(
            `Chrome CDP port ${cdpPort} is not available. Start Chrome with --remote-debugging-port=${cdpPort} or set AGENT_BROWSER_AUTO_LAUNCH_CHROME=true.`
          );
        }

        onUpdate?.({
          content: [
            {
              type: "text",
              text: `CDP port ${cdpPort} is closed; launching Chrome with remote debugging...`,
            },
          ],
          details: { cdpPort, autoLaunchChrome: true },
        });

        launchChromeWithCdp(
          chromeBinaryPath,
          cdpPort,
          workspaceRoot,
          launchArgs
        );

        const opened = await waitForPortOpen(cdpPort, 12000);
        if (!opened) {
          if (autoRestartChromeForCdp && process.platform === "darwin") {
            onUpdate?.({
              content: [
                {
                  type: "text",
                  text: "Chrome appears to be running without remote debugging; restarting Chrome automatically for CDP...",
                },
              ],
              details: { cdpPort, autoRestartChromeForCdp: true },
            });

            await restartChromeForCdp(cdpPort);
            launchChromeWithCdp(
              chromeBinaryPath,
              cdpPort,
              workspaceRoot,
              launchArgs
            );
            const openedAfterRestart = await waitForPortOpen(cdpPort, 15000);
            if (!openedAfterRestart) {
              throw new Error(
                `Failed to connect to Chrome CDP on ${cdpPort} after auto-restart. Start Chrome manually with: "${chromeBinaryPath}" --remote-debugging-port=${cdpPort}`
              );
            }
          } else {
            throw new Error(
              `Failed to connect to Chrome CDP on ${cdpPort} after auto-launch. Start Chrome manually with: "${chromeBinaryPath}" --remote-debugging-port=${cdpPort}`
            );
          }
        }
      }

      const fullArgs = ["--cdp", String(cdpPort), ...cliArgs];
      onUpdate?.({
        content: [{ type: "text", text: `Running: agent-browser ${fullArgs.join(" ")}` }],
        details: { args: fullArgs },
      });

      try {
        const { stdout, stderr } = await execFileAsync("agent-browser", fullArgs, {
          cwd: workspaceRoot,
          timeout,
          maxBuffer: 10 * 1024 * 1024,
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
            args: fullArgs,
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
        const output = [
          err.stdout ? `stdout:\n${err.stdout}` : "",
          err.stderr ? `stderr:\n${err.stderr}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        throw new Error(
          `agent-browser failed${err.code ? ` with exit code ${err.code}` : ""}\n${
            output || err.message
          }`
        );
      }
    },
  };
}
