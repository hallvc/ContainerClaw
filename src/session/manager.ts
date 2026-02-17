/**
 * Session persistence manager.
 */

import { join } from "@std/path";

export interface SessionMessage {
  role: string;
  content: string;
  timestamp: string;
  toolsUsed?: string[];
}

export interface Session {
  key: string;
  messages: SessionMessage[];
  lastConsolidated: number;
  createdAt: string;
  updatedAt: string;

  addMessage(role: string, content: string, toolsUsed?: string[]): void;
  clear(): void;
  getHistory(maxMessages: number): Array<{ role: string; content: string }>;
}

class SessionImpl implements Session {
  key: string;
  messages: SessionMessage[];
  lastConsolidated: number;
  createdAt: string;
  updatedAt: string;

  constructor(data: {
    key: string;
    messages: SessionMessage[];
    lastConsolidated: number;
    createdAt: string;
    updatedAt: string;
  }) {
    this.key = data.key;
    this.messages = data.messages;
    this.lastConsolidated = data.lastConsolidated;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  addMessage(role: string, content: string, toolsUsed?: string[]): void {
    this.messages.push({
      role,
      content,
      timestamp: new Date().toISOString(),
      ...(toolsUsed !== undefined ? { toolsUsed } : {}),
    });
    this.updatedAt = new Date().toISOString();
  }

  clear(): void {
    this.messages = [];
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
      const data = JSON.parse(raw);
      session = new SessionImpl({
        key: data.key ?? key,
        messages: data.messages ?? [],
        lastConsolidated: data.lastConsolidated ?? 0,
        createdAt: data.createdAt ?? new Date().toISOString(),
        updatedAt: data.updatedAt ?? new Date().toISOString(),
      });
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        const now = new Date().toISOString();
        session = new SessionImpl({
          key,
          messages: [],
          lastConsolidated: 0,
          createdAt: now,
          updatedAt: now,
        });
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
    const data = {
      key: session.key,
      messages: session.messages,
      lastConsolidated: session.lastConsolidated,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
    Deno.writeTextFileSync(path, JSON.stringify(data, null, 2));
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }
}
