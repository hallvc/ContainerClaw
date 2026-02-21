/**
 * Session persistence manager.
 */

import { join } from "@std/path";

export interface SessionMessage {
  role: string;
  content: string;
  timestamp: string;
  toolsUsed?: string[];
  [key: string]: unknown;
}

export interface Session {
  key: string;
  messages: SessionMessage[];
  lastConsolidated: number;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;

  addMessage(role: string, content: string, toolsUsed?: string[], extras?: Record<string, unknown>): void;
  clear(): void;
  getHistory(maxMessages: number): Array<{ role: string; content: string }>;
}

class SessionImpl implements Session {
  key: string;
  messages: SessionMessage[];
  lastConsolidated: number;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;

  constructor(data: {
    key: string;
    messages: SessionMessage[];
    lastConsolidated: number;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
  }) {
    this.key = data.key;
    this.messages = data.messages;
    this.lastConsolidated = data.lastConsolidated;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
    this.metadata = data.metadata ?? {};
  }

  addMessage(role: string, content: string, toolsUsed?: string[], extras?: Record<string, unknown>): void {
    this.messages.push({
      role,
      content,
      timestamp: new Date().toISOString(),
      ...(toolsUsed !== undefined ? { toolsUsed } : {}),
      ...(extras ?? {}),
    } as SessionMessage);
    this.updatedAt = new Date().toISOString();
  }

  clear(): void {
    this.messages = [];
    this.lastConsolidated = 0;
    this.updatedAt = new Date().toISOString();
  }

  getHistory(maxMessages: number): Array<{ role: string; content: string }> {
    return this.messages.slice(-maxMessages).map(({ role, content }) => ({
      role,
      content,
    }));
  }
}

function sanitizeKey(key: string): string {
  return key.replace(/[:/]/g, "_");
}

export class SessionManager {
  private dataDir: string;
  private cache: Map<string, SessionImpl> = new Map();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  private sessionsDir(): string {
    return join(this.dataDir, "sessions");
  }

  private sessionPath(key: string): string {
    return join(this.sessionsDir(), `${sanitizeKey(key)}.jsonl`);
  }

  private legacySessionPath(key: string): string {
    return join(this.sessionsDir(), `${sanitizeKey(key)}.json`);
  }

  private ensureSessionsDir(): void {
    try {
      Deno.mkdirSync(this.sessionsDir(), { recursive: true });
    } catch (err) {
      if (!(err instanceof Deno.errors.AlreadyExists)) {
        throw err;
      }
    }
  }

  getOrCreate(key: string): Session {
    const cached = this.cache.get(key);
    if (cached) return cached;

    this.ensureSessionsDir();
    const path = this.sessionPath(key);

    let session: SessionImpl;
    try {
      const raw = Deno.readTextFileSync(path);
      session = this.parseJsonl(key, raw);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        // Try legacy .json fallback
        try {
          const legacyRaw = Deno.readTextFileSync(this.legacySessionPath(key));
          const data = JSON.parse(legacyRaw);
          session = new SessionImpl({
            key: data.key ?? key,
            messages: data.messages ?? [],
            lastConsolidated: data.lastConsolidated ?? 0,
            createdAt: data.createdAt ?? new Date().toISOString(),
            updatedAt: data.updatedAt ?? new Date().toISOString(),
            metadata: data.metadata ?? {},
          });
        } catch (legacyErr) {
          if (legacyErr instanceof Deno.errors.NotFound) {
            const now = new Date().toISOString();
            session = new SessionImpl({
              key,
              messages: [],
              lastConsolidated: 0,
              createdAt: now,
              updatedAt: now,
            });
          } else {
            throw legacyErr;
          }
        }
      } else {
        throw err;
      }
    }

    this.cache.set(key, session);
    return session;
  }

  save(session: Session): void {
    this.ensureSessionsDir();
    const path = this.sessionPath(session.key);
    const metadataLine = JSON.stringify({
      _type: "metadata",
      created_at: session.createdAt,
      updated_at: session.updatedAt,
      metadata: session.metadata,
      last_consolidated: session.lastConsolidated,
    });
    const lines = [metadataLine];
    for (const msg of session.messages) {
      lines.push(JSON.stringify(msg));
    }
    Deno.writeTextFileSync(path, lines.join("\n") + "\n");

    // Remove legacy .json file if it exists
    try {
      Deno.removeSync(this.legacySessionPath(session.key));
    } catch {
      // Ignore - legacy file may not exist
    }

    this.cache.set(session.key, session as SessionImpl);
  }

  private parseJsonl(key: string, raw: string): SessionImpl {
    const lines = raw.split("\n").filter((l) => l.trim() !== "");
    const now = new Date().toISOString();
    let createdAt = now;
    let updatedAt = now;
    let metadata: Record<string, unknown> = {};
    let lastConsolidated = 0;
    const messages: SessionMessage[] = [];

    for (let i = 0; i < lines.length; i++) {
      try {
        const data = JSON.parse(lines[i]);
        if (data._type === "metadata") {
          createdAt = data.created_at ?? now;
          updatedAt = data.updated_at ?? now;
          metadata = data.metadata ?? {};
          lastConsolidated = data.last_consolidated ?? 0;
        } else {
          messages.push(data as SessionMessage);
        }
      } catch {
        console.warn(`Skipping malformed session line ${i + 1} for key "${key}"`);
      }
    }

    return new SessionImpl({
      key,
      messages,
      lastConsolidated,
      createdAt,
      updatedAt,
      metadata,
    });
  }

  listSessions(): Array<{ key: string; createdAt: string; updatedAt: string; path: string }> {
    this.ensureSessionsDir();
    const sessions: Array<{ key: string; createdAt: string; updatedAt: string; path: string }> = [];

    for (const entry of Deno.readDirSync(this.sessionsDir())) {
      if (!entry.isFile || !entry.name.endsWith(".jsonl")) continue;
      const filePath = join(this.sessionsDir(), entry.name);
      try {
        const raw = Deno.readTextFileSync(filePath);
        const firstLine = raw.split("\n")[0];
        if (!firstLine) continue;
        const data = JSON.parse(firstLine);
        if (data._type !== "metadata") continue;
        const stem = entry.name.replace(/\.jsonl$/, "");
        sessions.push({
          key: stem.replace(/_/g, ":"),
          createdAt: data.created_at ?? "",
          updatedAt: data.updated_at ?? "",
          path: filePath,
        });
      } catch {
        continue;
      }
    }

    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }
}
