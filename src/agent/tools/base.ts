/**
 * Tool interface and registry for agent tools.
 */

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  execute(args: Record<string, unknown>): Promise<string>;
}

const TOOL_MAX_RETRIES = 2;
const TOOL_RETRY_BASE_MS = 1000;

/** Check if an error is transient and worth retrying (timeouts, network failures). */
function isRetryableError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "TimeoutError") return true;
  if (err instanceof TypeError && /fetch|network/i.test(err.message)) return true;
  if (err instanceof Error && err.cause) return isRetryableError(err.cause);
  return false;
}

/** Interface for tools that accept channel/chat context. */
export interface ContextAware {
  setContext(channel: string, chatId: string, metadata?: Record<string, unknown>): void;
}

/** Type guard to check if a tool implements ContextAware. */
export function isContextAware(tool: Tool): tool is Tool & ContextAware {
  return "setContext" in tool &&
    typeof (tool as unknown as ContextAware).setContext === "function";
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      return `Error: Tool "${name}" not found.`;
    }
    let lastErr: unknown;
    for (let attempt = 0; attempt <= TOOL_MAX_RETRIES; attempt++) {
      try {
        return await tool.execute(args);
      } catch (err) {
        lastErr = err;
        if (attempt < TOOL_MAX_RETRIES && isRetryableError(err)) {
          const delay = TOOL_RETRY_BASE_MS * Math.pow(2, attempt) +
            Math.random() * 500;
          console.warn(
            `Tool "${name}" failed (attempt ${attempt + 1}/${TOOL_MAX_RETRIES + 1}), retrying in ${Math.round(delay)}ms: ${err instanceof Error ? err.message : err}`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        break;
      }
    }
    const message = lastErr instanceof Error
      ? lastErr.message
      : String(lastErr);
    // Sanitize timeout/signal errors so the LLM doesn't parrot "Signal timed out." to users
    const isTimeout = (lastErr instanceof DOMException && lastErr.name === "TimeoutError") ||
      /^(The )?signal (has been aborted|timed out)/i.test(message);
    if (isTimeout) {
      console.error(`Tool "${name}" timed out after retries`);
      return `The ${name} tool timed out after multiple retries. The target may be slow or unresponsive — try a different URL or try again later.`;
    }
    return `Error executing tool "${name}": ${message}`;
  }

  async executeParallel(
    calls: Array<{ name: string; args: Record<string, unknown> }>,
  ): Promise<Array<{ name: string; result: string }>> {
    const results = await Promise.allSettled(
      calls.map((c) => this.execute(c.name, c.args)),
    );
    return results.map((r, i) => ({
      name: calls[i].name,
      result: r.status === "fulfilled"
        ? r.value
        : `Error executing tool "${calls[i].name}": ${r.reason}`,
    }));
  }

  getDefinitions(): Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }> {
    return Array.from(this.tools.values()).map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
}
