/**
 * Workspace Health Tool — LLM-callable tool for recording answers/skips
 * and updating workspace files based on user responses.
 */

import { join } from "@std/path";
import type { Tool } from "./base.ts";
import { analyzeHealth } from "../../workspace/health.ts";
import { HealthStateManager } from "../../workspace/health_state.ts";

export class WorkspaceHealthTool implements Tool {
  name = "workspace_health";
  description =
    "Record user answers to workspace profile questions, skip questions, or check workspace health status. " +
    "Use 'record_answer' when the user answers a profile question (name, timezone, preferences, etc.). " +
    "Use 'record_skip' when the user says 'skip', 'not now', or 'later'. " +
    "Use 'check_status' to see what profile information is still missing.";
  parameters = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["record_answer", "record_skip", "check_status"],
        description: "The action to perform",
      },
      field_key: {
        type: "string",
        description:
          "The field being answered/skipped (e.g., 'user.name', 'user.timezone', 'user.comm_style')",
      },
      value: {
        type: "string",
        description: "The extracted answer value (for record_answer only)",
      },
    },
    required: ["action"],
  };

  private workspace: string;
  private defaultsDir: string;
  private healthState: HealthStateManager;

  constructor(
    workspace: string,
    defaultsDir: string,
    healthState: HealthStateManager,
  ) {
    this.workspace = workspace;
    this.defaultsDir = defaultsDir;
    this.healthState = healthState;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const action = args.action as string;
    const fieldKey = args.field_key as string | undefined;
    const value = args.value as string | undefined;

    switch (action) {
      case "record_answer":
        return await this.recordAnswer(fieldKey, value);
      case "record_skip":
        return await this.recordSkip(fieldKey);
      case "check_status":
        return await this.checkStatus();
      default:
        return `Unknown action: ${action}`;
    }
  }

  private async recordAnswer(
    fieldKey?: string,
    value?: string,
  ): Promise<string> {
    if (!fieldKey) return "Error: field_key is required for record_answer";
    if (!value) return "Error: value is required for record_answer";

    try {
      await this.updateWorkspaceFile(fieldKey, value);
      this.healthState.recordCompletion(fieldKey);
      await this.healthState.save();
      return `Updated ${fieldKey} to "${value}". Profile information saved.`;
    } catch (err) {
      return `Error updating ${fieldKey}: ${err instanceof Error ? err.message : err}`;
    }
  }

  private async recordSkip(fieldKey?: string): Promise<string> {
    if (!fieldKey) return "Error: field_key is required for record_skip";

    this.healthState.recordSkip(fieldKey);
    await this.healthState.save();
    return `Skipped ${fieldKey}. I'll ask again later.`;
  }

  private async checkStatus(): Promise<string> {
    const health = await analyzeHealth(this.workspace, this.defaultsDir);
    const state = this.healthState.getState();

    const lines: string[] = [
      `Workspace health: ${health.overallScore}% complete`,
      `Complete: ${health.isComplete ? "Yes" : "No"}`,
      `Questions asked today: ${state.questionsAskedToday}`,
      `Pending question: ${state.pendingQuestion ?? "none"}`,
      "",
    ];

    for (const file of health.files) {
      lines.push(`**${file.file}**: ${file.score}%`);
      for (const gap of file.gaps) {
        const skipped = state.skippedFields[gap.fieldKey]
          ? " (skipped)"
          : "";
        lines.push(`  - ${gap.field}: ${gap.currentValue}${skipped}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Update the appropriate workspace file based on field key and value.
   */
  private async updateWorkspaceFile(
    fieldKey: string,
    value: string,
  ): Promise<void> {
    const [filePrefix] = fieldKey.split(".");

    switch (filePrefix) {
      case "user":
        await this.updateUserMd(fieldKey, value);
        break;
      case "soul":
      case "heartbeat":
      case "agents":
      case "tools":
        // For these files, the LLM handles the update via write_file/edit_file.
        // We just record the completion.
        break;
      default:
        throw new Error(`Unknown field prefix: ${filePrefix}`);
    }
  }

  private async updateUserMd(fieldKey: string, value: string): Promise<void> {
    const filePath = join(this.workspace, "USER.md");
    let content: string;
    try {
      content = await Deno.readTextFile(filePath);
    } catch {
      throw new Error("USER.md not found");
    }

    let updated: string;

    switch (fieldKey) {
      case "user.name":
        updated = content.replace(
          /(\*\*Name\*\*:\s*)\(your name\)/i,
          `$1${value}`,
        );
        break;
      case "user.timezone":
        updated = content.replace(
          /(\*\*Timezone\*\*:\s*)\(your timezone[^)]*\)/i,
          `$1${value}`,
        );
        break;
      case "user.language":
        updated = content.replace(
          /(\*\*Language\*\*:\s*)\(preferred language\)/i,
          `$1${value}`,
        );
        break;
      case "user.role":
        updated = content.replace(
          /(\*\*Primary Role\*\*:\s*)\(your role[^)]*\)/i,
          `$1${value}`,
        );
        break;
      case "user.projects":
        updated = content.replace(
          /(\*\*Main Projects\*\*:\s*)\(what you're working on\)/i,
          `$1${value}`,
        );
        break;
      case "user.tools":
        updated = content.replace(
          /(\*\*Tools You Use\*\*:\s*)\(IDEs, languages[^)]*\)/i,
          `$1${value}`,
        );
        break;
      case "user.comm_style":
        updated = this.updateCheckboxSection(content, "### Communication Style", value);
        break;
      case "user.response_length":
        updated = this.updateCheckboxSection(content, "### Response Length", value);
        break;
      case "user.tech_level":
        updated = this.updateCheckboxSection(content, "### Technical Level", value);
        break;
      case "user.topics":
        updated = this.updateTopics(content, value);
        break;
      case "user.instructions":
        updated = content.replace(
          /\(Any specific instructions for how the assistant should behave\)/,
          value,
        );
        break;
      default:
        throw new Error(`Unknown USER.md field: ${fieldKey}`);
    }

    await Deno.writeTextFile(filePath, updated);
  }

  /**
   * Update a checkbox section: uncheck all, then check the matching option.
   * If the answer doesn't match any option, append it as checked.
   */
  private updateCheckboxSection(
    content: string,
    sectionHeader: string,
    value: string,
  ): string {
    const idx = content.indexOf(sectionHeader);
    if (idx === -1) return content;

    const before = content.slice(0, idx);
    const afterHeader = content.slice(idx);
    const lines = afterHeader.split("\n");
    const result: string[] = [];
    let inSection = false;
    let matched = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === sectionHeader) {
        inSection = true;
        result.push(line);
        continue;
      }

      if (inSection && (trimmed.startsWith("###") || trimmed.startsWith("##"))) {
        // End of section — if we didn't match, append the value
        if (!matched) {
          result.push(`- [x] ${value}`);
          matched = true;
        }
        inSection = false;
        result.push(line);
        continue;
      }

      if (inSection && (trimmed.startsWith("- [") || trimmed.startsWith("* ["))) {
        // Extract the option text
        const optionText = trimmed.replace(/^[-*]\s*\[[ x]\]\s*/, "").trim();
        if (optionText.toLowerCase() === value.toLowerCase()) {
          result.push(line.replace(/\[[ x]\]/, "[x]"));
          matched = true;
        } else {
          result.push(line.replace(/\[x\]/, "[ ]"));
        }
        continue;
      }

      result.push(line);
    }

    // If we reached end without matching, append
    if (inSection && !matched) {
      // Find the last checkbox line and append after it
      const lastCheckboxIdx = result.findLastIndex((l) =>
        l.trim().startsWith("- [") || l.trim().startsWith("* [")
      );
      if (lastCheckboxIdx !== -1) {
        result.splice(lastCheckboxIdx + 1, 0, `- [x] ${value}`);
      }
    }

    return before + result.join("\n");
  }

  /**
   * Update Topics of Interest — replace empty bullets or append.
   */
  private updateTopics(content: string, value: string): string {
    const topics = value.split(/[,\n]/).map((t) => t.trim()).filter((t) => t);
    const idx = content.indexOf("## Topics of Interest");
    if (idx === -1) return content;

    const before = content.slice(0, idx);
    const afterHeader = content.slice(idx);
    const lines = afterHeader.split("\n");
    const result: string[] = [];
    let inSection = false;
    let emptyBulletsReplaced = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === "## Topics of Interest") {
        inSection = true;
        result.push(line);
        continue;
      }

      if (inSection && (trimmed.startsWith("##") || trimmed.startsWith("---"))) {
        // End of section — append remaining topics
        for (let i = emptyBulletsReplaced; i < topics.length; i++) {
          result.push(`- ${topics[i]}`);
        }
        inSection = false;
        result.push(line);
        continue;
      }

      if (inSection && (trimmed === "-" || trimmed === "- " || trimmed === "*")) {
        // Empty bullet — replace with topic if available
        if (emptyBulletsReplaced < topics.length) {
          result.push(`- ${topics[emptyBulletsReplaced]}`);
          emptyBulletsReplaced++;
        }
        continue;
      }

      result.push(line);
    }

    return before + result.join("\n");
  }
}
