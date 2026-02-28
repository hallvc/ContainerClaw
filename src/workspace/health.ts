/**
 * Workspace Health Analyzer — detects gaps/placeholder content in workspace files.
 */

import { join } from "@std/path";
import { isHeartbeatEmpty } from "../heartbeat/service.ts";
import { QUESTION_BANK } from "./questions.ts";

export interface GapInfo {
  file: string;
  section: string;
  field: string;
  fieldKey: string;
  currentValue: string;
  question: string;
  priority: number;
}

export interface FileHealth {
  file: string;
  score: number;
  gaps: GapInfo[];
}

export interface WorkspaceHealth {
  overallScore: number;
  files: FileHealth[];
  isComplete: boolean;
}

/** Placeholder patterns in USER.md */
const USER_FIELDS: Array<{
  fieldKey: string;
  field: string;
  section: string;
  pattern: RegExp;
  priority: number;
}> = [
  { fieldKey: "user.name", field: "Name", section: "Basic Information", pattern: /\*\*Name\*\*:\s*\(your name\)/i, priority: 10 },
  { fieldKey: "user.timezone", field: "Timezone", section: "Basic Information", pattern: /\*\*Timezone\*\*:\s*\(your timezone/i, priority: 9 },
  { fieldKey: "user.language", field: "Language", section: "Basic Information", pattern: /\*\*Language\*\*:\s*\(preferred language\)/i, priority: 4 },
  { fieldKey: "user.role", field: "Primary Role", section: "Work Context", pattern: /\*\*Primary Role\*\*:\s*\(your role/i, priority: 6 },
  { fieldKey: "user.projects", field: "Main Projects", section: "Work Context", pattern: /\*\*Main Projects\*\*:\s*\(what you're working on\)/i, priority: 5 },
  { fieldKey: "user.tools", field: "Tools You Use", section: "Work Context", pattern: /\*\*Tools You Use\*\*:\s*\(IDEs, languages/i, priority: 5 },
];

/** Checkbox sections in USER.md */
const USER_CHECKBOX_FIELDS: Array<{
  fieldKey: string;
  field: string;
  section: string;
  sectionHeader: string;
  priority: number;
}> = [
  { fieldKey: "user.comm_style", field: "Communication Style", section: "Preferences", sectionHeader: "### Communication Style", priority: 8 },
  { fieldKey: "user.response_length", field: "Response Length", section: "Preferences", sectionHeader: "### Response Length", priority: 4 },
  { fieldKey: "user.tech_level", field: "Technical Level", section: "Preferences", sectionHeader: "### Technical Level", priority: 7 },
];

/**
 * Check if a checkbox section has any checked items.
 * Returns true if ALL boxes are unchecked (gap exists).
 */
function isCheckboxSectionUnchecked(content: string, sectionHeader: string): boolean {
  const idx = content.indexOf(sectionHeader);
  if (idx === -1) return false;

  const afterHeader = content.slice(idx + sectionHeader.length);
  const lines = afterHeader.split("\n");
  let hasChecked = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("###") || trimmed.startsWith("##")) break;
    if (trimmed.startsWith("- [x]") || trimmed.startsWith("* [x]")) {
      hasChecked = true;
      break;
    }
  }

  return !hasChecked;
}

/**
 * Check if Topics of Interest has any entries.
 */
function hasEmptyTopics(content: string): boolean {
  const idx = content.indexOf("## Topics of Interest");
  if (idx === -1) return false;

  const afterHeader = content.slice(idx + "## Topics of Interest".length);
  const lines = afterHeader.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("##")) break;
    if (trimmed.startsWith("---")) break;
    // Non-empty bullet
    if (trimmed.startsWith("- ") && trimmed.length > 2) return false;
    if (trimmed.startsWith("* ") && trimmed.length > 2) return false;
  }

  return true;
}

/**
 * Check if Special Instructions still has placeholder text.
 */
function hasPlaceholderInstructions(content: string): boolean {
  return content.includes("(Any specific instructions for how the assistant should behave)");
}

async function readFile(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return null;
  }
}

function getQuestionForField(fieldKey: string): string {
  const entry = QUESTION_BANK[fieldKey];
  if (!entry) return `Tell me about your ${fieldKey}`;
  const questions = entry.direct;
  return questions[Math.floor(Math.random() * questions.length)];
}

/**
 * Analyze USER.md for gaps.
 */
function analyzeUserMd(content: string): GapInfo[] {
  const gaps: GapInfo[] = [];

  for (const field of USER_FIELDS) {
    if (field.pattern.test(content)) {
      const match = content.match(field.pattern);
      gaps.push({
        file: "USER.md",
        section: field.section,
        field: field.field,
        fieldKey: field.fieldKey,
        currentValue: match?.[0] ?? "(placeholder)",
        question: getQuestionForField(field.fieldKey),
        priority: field.priority,
      });
    }
  }

  for (const field of USER_CHECKBOX_FIELDS) {
    if (isCheckboxSectionUnchecked(content, field.sectionHeader)) {
      gaps.push({
        file: "USER.md",
        section: field.section,
        field: field.field,
        fieldKey: field.fieldKey,
        currentValue: "(no selection)",
        question: getQuestionForField(field.fieldKey),
        priority: field.priority,
      });
    }
  }

  if (hasEmptyTopics(content)) {
    gaps.push({
      file: "USER.md",
      section: "Topics of Interest",
      field: "Topics",
      fieldKey: "user.topics",
      currentValue: "(empty)",
      question: getQuestionForField("user.topics"),
      priority: 4,
    });
  }

  if (hasPlaceholderInstructions(content)) {
    gaps.push({
      file: "USER.md",
      section: "Special Instructions",
      field: "Instructions",
      fieldKey: "user.instructions",
      currentValue: "(placeholder)",
      question: getQuestionForField("user.instructions"),
      priority: 3,
    });
  }

  return gaps;
}

/**
 * Analyze a file by comparing against its default template.
 * Returns a single gap if the file is identical to the default.
 */
function analyzeByDefault(
  content: string,
  defaultContent: string,
  file: string,
  fieldKey: string,
  field: string,
  priority: number,
): GapInfo[] {
  if (content.trim() === defaultContent.trim()) {
    return [{
      file,
      section: "Entire File",
      field,
      fieldKey,
      currentValue: "(default, not customized)",
      question: getQuestionForField(fieldKey),
      priority,
    }];
  }
  return [];
}

/**
 * Analyze the full workspace for health gaps.
 */
export async function analyzeHealth(
  workspace: string,
  defaultsDir: string,
): Promise<WorkspaceHealth> {
  const files: FileHealth[] = [];

  // --- USER.md ---
  const userContent = await readFile(join(workspace, "USER.md"));
  if (userContent) {
    const gaps = analyzeUserMd(userContent);
    // Total possible fields: 6 text + 3 checkbox + topics + instructions = 11
    const totalFields = 11;
    const filledFields = totalFields - gaps.length;
    files.push({
      file: "USER.md",
      score: Math.round((filledFields / totalFields) * 100),
      gaps,
    });
  }

  // --- SOUL.md ---
  const soulContent = await readFile(join(workspace, "SOUL.md"));
  const soulDefault = await readFile(join(defaultsDir, "SOUL.md"));
  if (soulContent && soulDefault) {
    const gaps = analyzeByDefault(soulContent, soulDefault, "SOUL.md", "soul.personality", "Personality", 2);
    files.push({
      file: "SOUL.md",
      score: gaps.length === 0 ? 100 : 0,
      gaps,
    });
  }

  // --- HEARTBEAT.md ---
  const heartbeatContent = await readFile(join(workspace, "HEARTBEAT.md"));
  if (heartbeatContent) {
    const empty = isHeartbeatEmpty(heartbeatContent);
    const gaps: GapInfo[] = empty
      ? [{
        file: "HEARTBEAT.md",
        section: "Active Tasks",
        field: "Tasks",
        fieldKey: "heartbeat.tasks",
        currentValue: "(no tasks configured)",
        question: getQuestionForField("heartbeat.tasks"),
        priority: 1,
      }]
      : [];
    files.push({
      file: "HEARTBEAT.md",
      score: empty ? 0 : 100,
      gaps,
    });
  }

  // --- AGENTS.md ---
  const agentsContent = await readFile(join(workspace, "AGENTS.md"));
  const agentsDefault = await readFile(join(defaultsDir, "AGENTS.md"));
  if (agentsContent && agentsDefault) {
    const gaps = analyzeByDefault(agentsContent, agentsDefault, "AGENTS.md", "agents.custom", "Custom Instructions", 1);
    files.push({
      file: "AGENTS.md",
      score: gaps.length === 0 ? 100 : 0,
      gaps,
    });
  }

  // --- TOOLS.md ---
  const toolsContent = await readFile(join(workspace, "TOOLS.md"));
  const toolsDefault = await readFile(join(defaultsDir, "TOOLS.md"));
  if (toolsContent && toolsDefault) {
    const gaps = analyzeByDefault(toolsContent, toolsDefault, "TOOLS.md", "tools.custom", "Custom Tools", 1);
    files.push({
      file: "TOOLS.md",
      score: gaps.length === 0 ? 100 : 0,
      gaps,
    });
  }

  // Calculate overall score
  const totalScore = files.length > 0
    ? Math.round(files.reduce((sum, f) => sum + f.score, 0) / files.length)
    : 0;
  const allGaps = files.flatMap((f) => f.gaps);

  return {
    overallScore: totalScore,
    files,
    isComplete: allGaps.length === 0,
  };
}
