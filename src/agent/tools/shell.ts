/**
 * Shell execution tool with timeout and workspace cwd.
 */

import type { Tool } from "./base.ts";

const MAX_OUTPUT = 10_000;

export class ExecTool implements Tool {
  name = "exec";
  description = "Execute a shell command in the workspace directory.";
  parameters = {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to execute." },
      timeout_ms: {
        type: "number",
        description: "Timeout in milliseconds (default 30000).",
      },
    },
    required: ["command"],
  };

  constructor(private workspace: string) {}

  async execute(args: Record<string, unknown>): Promise<string> {
    const command = String(args.command);
    const timeoutMs = typeof args.timeout_ms === "number"
      ? args.timeout_ms
      : 30_000;

    const cmd = new Deno.Command("sh", {
      args: ["-c", command],
      cwd: this.workspace,
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(timeoutMs),
    });

    const { stdout, stderr } = await cmd.output();

    const decoder = new TextDecoder();
    const out = decoder.decode(stdout);
    const err = decoder.decode(stderr);
    const combined = out + (err ? (out ? "\n" : "") + err : "");

    if (combined.length > MAX_OUTPUT) {
      return combined.slice(0, MAX_OUTPUT) + "\n[output truncated]";
    }
    return combined;
  }
}
