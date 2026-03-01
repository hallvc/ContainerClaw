import type { IndexFact, IndexEntity, IndexLearning } from "./memory.ts";

export type ContentType = "daily" | "learning" | "memory" | "entity";

export interface SearchResult {
  id: string;
  content: string;
  source: string;
  date: string;
  file: string;
  tags: string[];
  score: number;
  type: ContentType;
}

export interface SearchOptions {
  limit?: number;
  type?: ContentType;
  overFetchFactor?: number; // default 5
}

export interface SearchBackend {
  /** Build/rebuild the index from parsed facts, entities, and learnings */
  index(facts: IndexFact[], entities: IndexEntity[], learnings: IndexLearning[]): Promise<void>;

  /** Search with raw BM25/keyword scoring */
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;

  /** Search with recency boost applied (30-day decay for daily, flat 1.5x for learnings) */
  searchWithRecency(query: string, options?: SearchOptions): Promise<SearchResult[]>;

  /** Check if the index is stale relative to source files */
  isStale(files: string[]): Promise<boolean>;

  /** Close any open connections/resources */
  close(): void;
}
