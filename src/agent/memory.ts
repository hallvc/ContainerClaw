import { join } from "@std/path";

export class MemoryStore {
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  private memoryPath(): string {
    return join(this.dataDir, "MEMORY.md");
  }

  private historyPath(): string {
    return join(this.dataDir, "HISTORY.md");
  }

  async readLongTerm(): Promise<string> {
    try {
      return await Deno.readTextFile(this.memoryPath());
    } catch {
      return "";
    }
  }

  async writeLongTerm(content: string): Promise<void> {
    await Deno.mkdir(this.dataDir, { recursive: true });
    await Deno.writeTextFile(this.memoryPath(), content);
  }

  async appendHistory(entry: string): Promise<void> {
    await Deno.mkdir(this.dataDir, { recursive: true });
    const line = `[${new Date().toISOString()}] ${entry}\n`;
    await using file = await Deno.open(this.historyPath(), {
      write: true,
      create: true,
      append: true,
    });
    await file.write(new TextEncoder().encode(line));
  }

  async getMemoryContext(): Promise<string> {
    const memory = await this.readLongTerm();
    if (!memory.trim()) {
      return "";
    }
    return `## Long-term Memory\n\n${memory}`;
  }
}
