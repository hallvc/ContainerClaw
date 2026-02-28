/**
 * Workspace Health State Manager — persists health check state across restarts.
 */

import { join } from "@std/path";
import type { GapInfo } from "./health.ts";

export interface HealthCheckState {
  questionsAskedToday: number;
  lastQuestionDate: string;
  lastProactiveDate: string;
  lastActiveChannel: string | null;
  lastActiveChatId: string | null;
  skippedFields: Record<string, string>;
  completedFields: string[];
  piggybackedToday: boolean;
  pendingQuestion: string | null;
}

function defaultState(): HealthCheckState {
  return {
    questionsAskedToday: 0,
    lastQuestionDate: "",
    lastProactiveDate: "",
    lastActiveChannel: null,
    lastActiveChatId: null,
    skippedFields: {},
    completedFields: [],
    piggybackedToday: false,
    pendingQuestion: null,
  };
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

export class HealthStateManager {
  private dataDir: string;
  private state: HealthCheckState;
  private maxQuestionsPerDay: number;
  private skipCooldownHours: number;

  constructor(dataDir: string, maxQuestionsPerDay = 2, skipCooldownHours = 24) {
    this.dataDir = dataDir;
    this.maxQuestionsPerDay = maxQuestionsPerDay;
    this.skipCooldownHours = skipCooldownHours;
    this.state = defaultState();
  }

  private filePath(): string {
    return join(this.dataDir, "workspace-health.json");
  }

  async load(): Promise<void> {
    try {
      const raw = await Deno.readTextFile(this.filePath());
      const parsed = JSON.parse(raw);
      this.state = { ...defaultState(), ...parsed };
    } catch {
      this.state = defaultState();
    }
    this.resetDaily();
  }

  async save(): Promise<void> {
    const tmpPath = this.filePath() + ".tmp";
    await Deno.writeTextFile(tmpPath, JSON.stringify(this.state, null, 2));
    await Deno.rename(tmpPath, this.filePath());
  }

  /** Reset daily counters if the date has changed. */
  resetDaily(): void {
    const today = todayISO();
    if (this.state.lastQuestionDate !== today) {
      this.state.questionsAskedToday = 0;
      this.state.piggybackedToday = false;
      this.state.lastQuestionDate = today;
    }
  }

  canAskToday(): boolean {
    this.resetDaily();
    return this.state.questionsAskedToday < this.maxQuestionsPerDay;
  }

  canAskField(fieldKey: string): boolean {
    if (this.state.completedFields.includes(fieldKey)) return false;

    const skipDate = this.state.skippedFields[fieldKey];
    if (skipDate) {
      const skippedAt = new Date(skipDate);
      const cooldownMs = this.skipCooldownHours * 60 * 60 * 1000;
      if (Date.now() - skippedAt.getTime() < cooldownMs) return false;
    }

    return true;
  }

  /** Get the next highest-priority question that can be asked. */
  getNextQuestion(gaps: GapInfo[]): GapInfo | null {
    if (!this.canAskToday()) return null;

    const askable = gaps
      .filter((g) => this.canAskField(g.fieldKey))
      .sort((a, b) => b.priority - a.priority);

    return askable[0] ?? null;
  }

  recordQuestion(fieldKey: string): void {
    this.resetDaily();
    this.state.questionsAskedToday++;
    this.state.pendingQuestion = fieldKey;
    this.state.lastQuestionDate = todayISO();
  }

  recordSkip(fieldKey: string): void {
    this.state.skippedFields[fieldKey] = new Date().toISOString();
    this.state.pendingQuestion = null;
  }

  recordCompletion(fieldKey: string): void {
    if (!this.state.completedFields.includes(fieldKey)) {
      this.state.completedFields.push(fieldKey);
    }
    this.state.pendingQuestion = null;
  }

  recordChannelActivity(channel: string, chatId: string): void {
    if (this.state.lastActiveChannel !== channel || this.state.lastActiveChatId !== chatId) {
      this.state.lastActiveChannel = channel;
      this.state.lastActiveChatId = chatId;
    }
  }

  recordPiggyback(): void {
    this.state.piggybackedToday = true;
  }

  recordProactiveNudge(): void {
    this.state.lastProactiveDate = todayISO();
  }

  clearPendingQuestion(): void {
    this.state.pendingQuestion = null;
  }

  /** Check if a proactive nudge should be sent. */
  needsProactiveNudge(hasGaps: boolean): boolean {
    this.resetDaily();
    return (
      !this.state.piggybackedToday &&
      hasGaps &&
      this.state.lastActiveChannel !== null &&
      this.state.lastProactiveDate !== todayISO() &&
      this.canAskToday()
    );
  }

  get pendingQuestion(): string | null {
    return this.state.pendingQuestion;
  }

  get lastActiveChannel(): string | null {
    return this.state.lastActiveChannel;
  }

  get lastActiveChatId(): string | null {
    return this.state.lastActiveChatId;
  }

  get piggybackedToday(): boolean {
    return this.state.piggybackedToday;
  }

  /** Expose state for diagnostics / check_status. */
  getState(): Readonly<HealthCheckState> {
    return { ...this.state };
  }
}
