// @ts-nocheck — vendored Pi source (core/tools/bash.js @0.84.1, MIT, see ../PI-LICENSE);
// imports remapped to pi2dsh shims, logic byte-identical.
import { constants } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import { Container, Text, truncateToWidth } from '../../pi-tui.js';
import { spawn } from "child_process";
import { Type } from "typebox";
import { keyHint } from '../../pi-coding-agent.js';
import { truncateToVisualLines } from './visual-truncate.js';
import { theme } from '../../pi-coding-agent.js';
import { waitForChildProcess } from './child-process.js';
import { getShellConfig, getShellEnv, killProcessTree, trackDetachedChildPid, untrackDetachedChildPid, } from './shell.js';
import { OutputAccumulator } from "./output-accumulator.js";
import { getTextOutput, invalidArgText, str } from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "./truncate.js";
const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_TIMEOUT_SECONDS = MAX_TIMEOUT_MS / 1000;
function resolveTimeoutMs(timeout) {
    if (timeout === undefined)
        return undefined;
    if (!Number.isFinite(timeout) || timeout <= 0) {
        throw new Error("Invalid timeout: must be a finite number of seconds");
    }
    const timeoutMs = timeout * 1000;
    if (timeoutMs > MAX_TIMEOUT_MS) {
        throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`);
    }
    return timeoutMs;
}
const bashSchema = Type.Object({
    command: Type.String({ description: "Bash command to execute" }),
    timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
});
export const bashToolSystemPromptContribution = {
    snippet: "Execute bash commands (ls, grep, find, etc.)",
    guidelines: ["You can inspect PI_* environment variables for current model and session details."],
};
/**
 * Create bash operations using pi's built-in local shell execution backend.
 *
 * This is useful for extensions that intercept user_bash and still want pi's
 * standard local shell behavior while wrapping or rewriting commands.
 */
export function createLocalBashOperations(options) {
    return {
        exec: async (command, cwd, { onData, signal, timeout, env }) => {
            const timeoutMs = resolveTimeoutMs(timeout);
            if (signal?.aborted) {
                throw new Error("aborted");
            }
            const shellConfig = getShellConfig(options?.shellPath);
            try {
                await fsAccess(cwd, constants.F_OK);
            }
            catch {
                throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`);
            }
            const commandFromStdin = shellConfig.commandTransport === "stdin";
            const child = spawn(shellConfig.shell, commandFromStdin ? shellConfig.args : [...shellConfig.args, command], {
                cwd,
                detached: process.platform !== "win32",
                env: env ?? getShellEnv(),
                stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
                windowsHide: true,
            });
            if (commandFromStdin) {
                child.stdin?.on("error", () => { });
                child.stdin?.end(command);
            }
            if (child.pid)
                trackDetachedChildPid(child.pid);
            let timedOut = false;
            let timeoutHandle;
            const onAbort = () => {
                if (child.pid)
                    killProcessTree(child.pid);
            };
            try {
                // Set timeout if provided.
                if (timeoutMs !== undefined) {
                    timeoutHandle = setTimeout(() => {
                        timedOut = true;
                        if (child.pid)
                            killProcessTree(child.pid);
                    }, timeoutMs);
                }
                // Stream stdout and stderr.
                child.stdout?.on("data", onData);
                child.stderr?.on("data", onData);
                // Handle abort signal by killing the entire process tree.
                if (signal) {
                    if (signal.aborted)
                        onAbort();
                    else
                        signal.addEventListener("abort", onAbort, { once: true });
                }
                // Handle shell spawn errors and wait for the process to terminate without hanging
                // on inherited stdio handles held by detached descendants.
                const exitCode = await waitForChildProcess(child);
                if (signal?.aborted) {
                    throw new Error("aborted");
                }
                if (timedOut) {
                    throw new Error(`timeout:${timeout}`);
                }
                return { exitCode };
            }
            finally {
                if (child.pid)
                    untrackDetachedChildPid(child.pid);
                if (timeoutHandle)
                    clearTimeout(timeoutHandle);
                if (signal)
                    signal.removeEventListener("abort", onAbort);
            }
        },
    };
}
function resolveSpawnContext(command, cwd, spawnHook, exposeSessionEnvironment, ctx) {
    const env = { ...getShellEnv() };
    delete env.PI_SESSION_ID;
    delete env.PI_SESSION_FILE;
    delete env.PI_PROVIDER;
    delete env.PI_MODEL;
    delete env.PI_REASONING_LEVEL;
    if (exposeSessionEnvironment && ctx) {
        const model = ctx.model;
        env.PI_SESSION_ID = ctx.sessionManager.getSessionId();
        const sessionFile = ctx.sessionManager.getSessionFile();
        if (sessionFile)
            env.PI_SESSION_FILE = sessionFile;
        if (model) {
            env.PI_PROVIDER = model.provider;
            env.PI_MODEL = model.id;
        }
        if (ctx.thinkingLevel)
            env.PI_REASONING_LEVEL = ctx.thinkingLevel;
    }
    const baseContext = { command, cwd, env };
    return spawnHook ? spawnHook(baseContext) : baseContext;
}
const BASH_PREVIEW_LINES = 5;
const BASH_UPDATE_THROTTLE_MS = 100;
class BashResultRenderComponent extends Container {
    state = {
        cachedWidth: undefined,
        cachedLines: undefined,
        cachedSkipped: undefined,
    };
}
function formatDuration(ms) {
    return `${(ms / 1000).toFixed(1)}s`;
}
function formatBashCall(args) {
    const command = str(args?.command);
    const timeout = args?.timeout;
    const timeoutSuffix = timeout ? theme.fg("muted", ` (timeout ${timeout}s)`) : "";
    const commandDisplay = command === null ? invalidArgText(theme) : command ? command : theme.fg("toolOutput", "...");
    return theme.fg("toolTitle", theme.bold(`$ ${commandDisplay}`)) + timeoutSuffix;
}
function rebuildBashResultRenderComponent(component, result, options, showImages, startedAt, endedAt) {
    const state = component.state;
    component.clear();
    let output = getTextOutput(result, showImages).trim();
    const truncation = result.details?.truncation;
    const fullOutputPath = result.details?.fullOutputPath;
    if (!options.isPartial && truncation?.truncated && fullOutputPath && output.endsWith("]")) {
        const footerStart = output.lastIndexOf("\n\n[");
        if (footerStart !== -1 && output.slice(footerStart).includes(fullOutputPath)) {
            output = output.slice(0, footerStart).trimEnd();
        }
    }
    if (output) {
        const styledOutput = output
            .split("\n")
            .map((line) => theme.fg("toolOutput", line))
            .join("\n");
        if (options.expanded) {
            component.addChild(new Text(`\n${styledOutput}`, 0, 0));
        }
        else {
            component.addChild({
                render: (width) => {
                    if (state.cachedLines === undefined || state.cachedWidth !== width) {
                        const preview = truncateToVisualLines(styledOutput, BASH_PREVIEW_LINES, width);
                        state.cachedLines = preview.visualLines;
                        state.cachedSkipped = preview.skippedCount;
                        state.cachedWidth = width;
                    }
                    if (state.cachedSkipped && state.cachedSkipped > 0) {
                        const hint = theme.fg("muted", `... (${state.cachedSkipped} earlier lines,`) +
                            ` ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
                        return ["", truncateToWidth(hint, width, "..."), ...(state.cachedLines ?? [])];
                    }
                    return ["", ...(state.cachedLines ?? [])];
                },
                invalidate: () => {
                    state.cachedWidth = undefined;
                    state.cachedLines = undefined;
                    state.cachedSkipped = undefined;
                },
            });
        }
    }
    if (truncation?.truncated || fullOutputPath) {
        const warnings = [];
        if (fullOutputPath) {
            warnings.push(`Full output: ${fullOutputPath}`);
        }
        if (truncation?.truncated) {
            if (truncation.truncatedBy === "lines") {
                warnings.push(`Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`);
            }
            else {
                warnings.push(`Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)`);
            }
        }
        component.addChild(new Text(`\n${theme.fg("warning", `[${warnings.join(". ")}]`)}`, 0, 0));
    }
    if (startedAt !== undefined) {
        const label = options.isPartial ? "Elapsed" : "Took";
        const endTime = endedAt ?? Date.now();
        component.addChild(new Text(`\n${theme.fg("muted", `${label} ${formatDuration(endTime - startedAt)}`)}`, 0, 0));
    }
}
export function createBashToolDefinition(cwd, options) {
    const ops = options?.operations ?? createLocalBashOperations({ shellPath: options?.shellPath });
    const commandPrefix = options?.commandPrefix;
    const exposeSessionEnvironment = options?.exposeSessionEnvironment ?? true;
    const spawnHook = options?.spawnHook;
    return {
        name: "bash",
        label: "bash",
        description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
        promptSnippet: bashToolSystemPromptContribution.snippet,
        promptGuidelines: exposeSessionEnvironment ? [...bashToolSystemPromptContribution.guidelines] : undefined,
        parameters: bashSchema,
        async execute(_toolCallId, { command, timeout }, signal, onUpdate, ctx) {
            const resolvedCommand = commandPrefix ? `${commandPrefix}\n${command}` : command;
            const spawnContext = resolveSpawnContext(resolvedCommand, cwd, spawnHook, exposeSessionEnvironment, ctx);
            const output = new OutputAccumulator({ tempFilePrefix: "pi-bash" });
            let acceptingOutput = true;
            let updateTimer;
            let updateDirty = false;
            let lastUpdateAt = 0;
            const emitOutputUpdate = () => {
                if (!onUpdate || !updateDirty)
                    return;
                updateDirty = false;
                lastUpdateAt = Date.now();
                const snapshot = output.snapshot({ persistIfTruncated: true });
                onUpdate({
                    content: [{ type: "text", text: snapshot.content || "" }],
                    details: {
                        truncation: snapshot.truncation.truncated ? snapshot.truncation : undefined,
                        fullOutputPath: snapshot.fullOutputPath,
                    },
                });
            };
            const clearUpdateTimer = () => {
                if (updateTimer) {
                    clearTimeout(updateTimer);
                    updateTimer = undefined;
                }
            };
            const scheduleOutputUpdate = () => {
                if (!onUpdate)
                    return;
                updateDirty = true;
                const delay = BASH_UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt);
                if (delay <= 0) {
                    clearUpdateTimer();
                    emitOutputUpdate();
                    return;
                }
                updateTimer ??= setTimeout(() => {
                    updateTimer = undefined;
                    emitOutputUpdate();
                }, delay);
            };
            if (onUpdate) {
                onUpdate({ content: [], details: undefined });
            }
            const handleData = (data) => {
                if (!acceptingOutput)
                    return;
                output.append(data);
                scheduleOutputUpdate();
            };
            const finishOutput = async () => {
                acceptingOutput = false;
                output.finish();
                clearUpdateTimer();
                emitOutputUpdate();
                const snapshot = output.snapshot({ persistIfTruncated: true });
                await output.closeTempFile();
                return snapshot;
            };
            const formatOutput = (snapshot, emptyText = "(no output)") => {
                const truncation = snapshot.truncation;
                let text = snapshot.content || emptyText;
                let details;
                if (truncation.truncated) {
                    details = { truncation, fullOutputPath: snapshot.fullOutputPath };
                    const startLine = truncation.totalLines - truncation.outputLines + 1;
                    const endLine = truncation.totalLines;
                    if (truncation.lastLinePartial) {
                        const lastLineSize = formatSize(output.getLastLineBytes());
                        text += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${snapshot.fullOutputPath}]`;
                    }
                    else if (truncation.truncatedBy === "lines") {
                        text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${snapshot.fullOutputPath}]`;
                    }
                    else {
                        text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${snapshot.fullOutputPath}]`;
                    }
                }
                return { text, details };
            };
            const appendStatus = (text, status) => `${text ? `${text}\n\n` : ""}${status}`;
            try {
                let exitCode;
                try {
                    const result = await ops.exec(spawnContext.command, spawnContext.cwd, {
                        onData: handleData,
                        signal,
                        timeout,
                        env: spawnContext.env,
                    });
                    exitCode = result.exitCode;
                }
                catch (err) {
                    const snapshot = await finishOutput();
                    const { text } = formatOutput(snapshot, "");
                    if (err instanceof Error && err.message === "aborted") {
                        throw new Error(appendStatus(text, "Command aborted"));
                    }
                    if (err instanceof Error && err.message.startsWith("timeout:")) {
                        const timeoutSecs = err.message.split(":")[1];
                        throw new Error(appendStatus(text, `Command timed out after ${timeoutSecs} seconds`));
                    }
                    throw err;
                }
                const snapshot = await finishOutput();
                const { text: outputText, details } = formatOutput(snapshot);
                if (exitCode !== 0 && exitCode !== null) {
                    throw new Error(appendStatus(outputText, `Command exited with code ${exitCode}`));
                }
                return { content: [{ type: "text", text: outputText }], details };
            }
            finally {
                clearUpdateTimer();
            }
        },
        renderCall(args, _theme, context) {
            const state = context.state;
            if (context.executionStarted && state.startedAt === undefined) {
                state.startedAt = Date.now();
                state.endedAt = undefined;
            }
            const text = context.lastComponent ?? new Text("", 0, 0);
            text.setText(formatBashCall(args));
            return text;
        },
        renderResult(result, options, _theme, context) {
            const state = context.state;
            if (state.startedAt !== undefined && options.isPartial && !state.interval) {
                state.interval = setInterval(() => context.invalidate(), 1000);
            }
            if (!options.isPartial || context.isError) {
                state.endedAt ??= Date.now();
                if (state.interval) {
                    clearInterval(state.interval);
                    state.interval = undefined;
                }
            }
            const component = context.lastComponent ?? new BashResultRenderComponent();
            rebuildBashResultRenderComponent(component, result, options, context.showImages, state.startedAt, state.endedAt);
            component.invalidate();
            return component;
        },
    };
}
export function createBashTool(cwd, options) {
    const definition = createBashToolDefinition(cwd, options);
    const tool = wrapToolDefinition(definition);
    Object.assign(tool, {
        promptSnippet: definition.promptSnippet,
        promptGuidelines: definition.promptGuidelines,
    });
    return tool;
}
//# sourceMappingURL=bash.js.map