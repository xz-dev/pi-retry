import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isContextOverflow,
  isRetryableAssistantError,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import {
  getAgentDir,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export const CONFIG_FILE = "pi-retry.json";
export const DEFAULT_INCLUDE = ["OpenAI API error (520): 520 status code (no body)"];
export const RETRY_MARKER = "[pi-retry]";

export interface RetryConfig {
  include: string[];
}

const PROTECTED_LIMIT_PATTERN =
  /GoUsageLimitError|FreeUsageLimitError|usage.?limit|available balance|quota|budget|billing/i;

export function loadConfig(agentDir = getAgentDir()): RetryConfig {
  const path = join(agentDir, CONFIG_FILE);
  if (!existsSync(path)) return { include: [...DEFAULT_INCLUDE] };

  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || !("include" in value)) {
      return { include: [] };
    }

    const include = (value as { include?: unknown }).include;
    if (!Array.isArray(include) || include.some((item) => typeof item !== "string")) {
      return { include: [] };
    }

    return { include: include.map((item) => item.trim()).filter(Boolean) };
  } catch {
    return { include: [] };
  }
}

export function classifyError(
  message: AssistantMessage,
  config: RetryConfig,
  retryEnabled: boolean,
): AssistantMessage | undefined {
  if (!retryEnabled || message.stopReason !== "error" || !message.errorMessage) return;
  if (message.errorMessage.includes(RETRY_MARKER)) return;
  if (PROTECTED_LIMIT_PATTERN.test(message.errorMessage)) return;
  if (isContextOverflow(message)) return;
  if (isRetryableAssistantError(message)) return;

  const normalizedError = message.errorMessage.toLowerCase();
  const matched = config.include.find((value) =>
    normalizedError.includes(value.toLowerCase()),
  );
  if (!matched) return;

  return {
    ...message,
    errorMessage: `${message.errorMessage}\n\n${RETRY_MARKER} provider returned error`,
  };
}

function isRetryEnabled(ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">): boolean {
  return SettingsManager.create(ctx.cwd, getAgentDir(), {
    projectTrusted: ctx.isProjectTrusted(),
  }).getRetrySettings().enabled;
}

export default function retry(pi: ExtensionAPI): void {
  const config = loadConfig();

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;

    const message = classifyError(event.message, config, isRetryEnabled(ctx));
    if (message) return { message };
  });
}
