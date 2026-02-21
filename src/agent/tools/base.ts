/**
 * Tool interface and registry for agent tools.
 */

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  execute(args: Record<string, unknown>): Promise<string>;
}

/** Interface for tools that accept channel/chat context. */
export interface ContextAware {
  setContext(channel: string, chatId: string): void;
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
    try {
      return await tool.execute(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error executing tool "${name}": ${message}`;
    }
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
