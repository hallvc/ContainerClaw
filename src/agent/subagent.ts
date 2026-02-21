/**
 * Subagent manager for background task execution.
 *
 * Subagents are lightweight agent instances that run in the background
 * to handle specific tasks. They share the same LLM provider but have
 * isolated context and a focused system prompt.
 */

import type { MessageBus } from "../bus/queue.ts";
import { createInboundMessage } from "../bus/events.ts";
import type { LLMProvider } from "../providers/base.ts";
import { ToolRegistry } from "./tools/base.ts";
import {
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  ListDirTool,
} from "./tools/filesystem.ts";
import { ExecTool } from "./tools/shell.ts";
import { WebFetchTool } from "./tools/web.ts";

interface SubagentConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  execTimeoutMs?: number;
  maxConcurrent?: number;
}

const MAX_ITERATIONS = 15;
const MAX_CONCURRENT = 3;

export class SubagentManager {
  private provider: LLMProvider;
  private workspace: string;
  private bus: MessageBus;
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private execTimeoutMs: number;
  private maxConcurrent: number;
  private runningTasks: Map<string, Promise<void>> = new Map();

  constructor(
    provider: LLMProvider,
    workspace: string,
    bus: MessageBus,
    config: SubagentConfig,
  ) {
    this.provider = provider;
    this.workspace = workspace;
    this.bus = bus;
    this.model = config.model ?? provider.getDefaultModel();
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens ?? 4096;
    this.execTimeoutMs = config.execTimeoutMs ?? 60_000;
    this.maxConcurrent = config.maxConcurrent ?? MAX_CONCURRENT;
  }

  spawn(
    task: string,
    label?: string,
    originChannel = "cli",
    originChatId = "direct",
  ): string {
    if (this.runningTasks.size >= this.maxConcurrent) {
      return `Error: Concurrency limit reached (${this.maxConcurrent} subagents running). Please wait for a task to complete.`;
    }

    const taskId = crypto.randomUUID().slice(0, 8);
    const displayLabel = label ?? task.slice(0, 30) + (task.length > 30 ? "..." : "");
    const origin = { channel: originChannel, chatId: originChatId };

    const bgTask = this.runSubagent(taskId, task, displayLabel, origin);
    this.runningTasks.set(taskId, bgTask);
    bgTask.finally(() => this.runningTasks.delete(taskId));

    return `Subagent [${displayLabel}] started (id: ${taskId}). I'll notify you when it completes.`;
  }

  getRunningCount(): number {
    return this.runningTasks.size;
  }

  private async runSubagent(
    taskId: string,
    task: string,
    label: string,
    origin: { channel: string; chatId: string },
  ): Promise<void> {
    try {
      const tools = this.buildIsolatedTools();

      const systemPrompt = this.buildSubagentPrompt();
      const messages: Array<Record<string, unknown>> = [
        { role: "system", content: systemPrompt },
        { role: "user", content: task },
      ];

      let finalResult: string | null = null;
      const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, iterations: 0 };

      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const response = await this.provider.chat({
          messages: messages as Parameters<LLMProvider["chat"]>[0]["messages"],
          tools: tools.getDefinitions(),
          model: this.model,
          maxTokens: this.maxTokens,
          temperature: this.temperature,
        });

        // Accumulate token usage
        usage.promptTokens += response.usage.promptTokens ?? 0;
        usage.completionTokens += response.usage.completionTokens ?? 0;
        usage.totalTokens += response.usage.totalTokens ?? 0;
        usage.iterations = i + 1;

        if (response.toolCalls.length > 0) {
          const toolCallDicts = response.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
          messages.push({
            role: "assistant",
            content: response.content ?? "",
            tool_calls: toolCallDicts,
          });

          // Execute tool calls in parallel
          const toolResults = await tools.executeParallel(
            response.toolCalls.map((tc) => ({ name: tc.name, args: tc.arguments })),
          );
          for (let j = 0; j < response.toolCalls.length; j++) {
            messages.push({
              role: "tool",
              tool_call_id: response.toolCalls[j].id,
              name: toolResults[j].name,
              content: toolResults[j].result,
            });
          }
        } else {
          finalResult = response.content;
          break;
        }
      }

      if (finalResult === null) {
        finalResult = "Task completed but no final response was generated.";
      }

      if (usage.totalTokens > 0) {
        console.log(`Subagent usage: ${usage.totalTokens} tokens (${usage.iterations} iterations)`);
      }

      await this.announceResult(taskId, label, task, finalResult, origin, "ok");
    } catch (err) {
      const errorMsg = `Error: ${err instanceof Error ? err.message : String(err)}`;
      await this.announceResult(taskId, label, task, errorMsg, origin, "error");
    }
  }

  private async announceResult(
    _taskId: string,
    label: string,
    task: string,
    result: string,
    origin: { channel: string; chatId: string },
    status: string,
  ): Promise<void> {
    const statusText = status === "ok" ? "completed successfully" : "failed";

    const content = `[Subagent '${label}' ${statusText}]

Task: ${task}

Result:
${result}

Summarize this naturally for the user. Keep it brief (1-2 sentences). Do not mention technical details like "subagent" or task IDs.`;

    const msg = createInboundMessage({
      channel: "system",
      senderId: "subagent",
      chatId: `${origin.channel}:${origin.chatId}`,
      content,
    });

    await this.bus.publishInbound(msg);
  }

  private buildIsolatedTools(): ToolRegistry {
    const tools = new ToolRegistry();
    tools.register(new ReadFileTool(this.workspace));
    tools.register(new WriteFileTool(this.workspace));
    tools.register(new EditFileTool(this.workspace));
    tools.register(new ListDirTool(this.workspace));
    tools.register(new ExecTool(this.workspace, this.execTimeoutMs));
    tools.register(new WebFetchTool());
    return tools;
  }

  private buildSubagentPrompt(): string {
    const now = new Date().toISOString().replace("T", " ").slice(0, 16);

    return `# Subagent

## Current Time
${now}

You are a subagent spawned by the main agent to complete a specific task.

## Rules
1. Stay focused - complete only the assigned task, nothing else
2. Your final response will be reported back to the main agent
3. Do not initiate conversations or take on side tasks
4. Be concise but informative in your findings

## What You Can Do
- Read and write files in the workspace
- Execute shell commands
- Search the web and fetch web pages
- Complete the task thoroughly

## What You Cannot Do
- Send messages directly to users (no message tool available)
- Spawn other subagents
- Access the main agent's conversation history

## Workspace
Your workspace is at: ${this.workspace}
Skills are available at: ${this.workspace}/skills/ (read SKILL.md files as needed)

When you have completed the task, provide a clear summary of your findings or actions.`;
  }
}
