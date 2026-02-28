/**
 * Planning protocol: types and helpers for the two-loop planning architecture.
 *
 * When a user sends a complex request, the agent loop runs in "planning mode" first —
 * it produces a plan and sends it to the user via the message tool, then stops.
 * On the user's next message, the agent detects whether they confirmed, modified, or
 * rejected the plan, and either starts an "execution loop" or discards the plan.
 */

export interface PlanStep {
  description: string;
  status: "pending" | "done" | "skipped" | "amended";
}

export interface PlanAmendment {
  step: number;
  reason: string;
  newApproach: string;
}

export interface PlanState {
  status: "proposed" | "approved" | "executing" | "completed" | "amended";
  tier: 1 | 2 | 3 | 4;
  steps: PlanStep[];
  amendments: PlanAmendment[];
  lastReportedStep: number;
  planText: string;
}

// --- Detection helpers ---

const CONFIRM_PATTERNS = [
  /^go$/i,
  /^go\s+ahead/i,
  /^yes/i,
  /^yep/i,
  /^yeah/i,
  /^y$/i,
  /^ok(ay)?$/i,
  /^sure/i,
  /^do\s+it/i,
  /^looks?\s+good/i,
  /^sounds?\s+good/i,
  /^perfect/i,
  /^approved?/i,
  /^start/i,
  /^proceed/i,
  /^let'?s\s+go/i,
  /^ship\s+it/i,
  /^lgtm/i,
  /^👍/,
  /^✅/,
];

const REJECT_PATTERNS = [
  /^no$/i,
  /^nope/i,
  /^nah/i,
  /^never\s*mind/i,
  /^forget\s*(it|about)/i,
  /^cancel/i,
  /^stop/i,
  /^scratch\s+that/i,
  /^discard/i,
  /^don'?t\s+(do|bother)/i,
];

const PLAN_REQUEST_PATTERNS = [
  /\bplan\s+(this|it|first)\b/i,
  /\bshow\s+(me\s+)?a\s+plan\b/i,
  /\bdon'?t\s+just\s+do\s+it\b/i,
  /\bmake\s+a\s+plan\b/i,
  /\bplan\s+before\b/i,
  /\bplan\s+it\s+out\b/i,
];

/**
 * Returns true if the user's message looks like a confirmation of a proposed plan.
 */
export function isPlanConfirmation(text: string): boolean {
  const trimmed = text.trim();
  return CONFIRM_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Returns true if the user's message looks like a rejection of a proposed plan.
 */
export function isPlanRejection(text: string): boolean {
  const trimmed = text.trim();
  return REJECT_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Returns true if the user's message looks like a modification request.
 * This is the catch-all: if it's not a confirm or reject, and there's a pending plan,
 * treat it as a modification.
 */
export function isPlanModification(text: string): boolean {
  const trimmed = text.trim();
  return !isPlanConfirmation(trimmed) && !isPlanRejection(trimmed);
}

/**
 * Returns true if the user is explicitly requesting a plan (forces Tier 4).
 */
export function isPlanRequest(text: string): boolean {
  return PLAN_REQUEST_PATTERNS.some((p) => p.test(text));
}

/**
 * Try to extract structured steps from a plan message the LLM sent.
 * Looks for numbered list items (1. ... 2. ... etc.)
 */
export function parsePlanSteps(planText: string): PlanStep[] {
  const lines = planText.split("\n");
  const steps: PlanStep[] = [];

  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\.\s+(.+)/);
    if (match) {
      steps.push({ description: match[2].trim(), status: "pending" });
    }
  }

  return steps;
}

/**
 * Create a fresh PlanState from a plan message.
 */
export function createPlanState(planText: string, tier: 2 | 3 | 4): PlanState {
  return {
    status: "proposed",
    tier,
    steps: parsePlanSteps(planText),
    amendments: [],
    lastReportedStep: 0,
    planText,
  };
}
