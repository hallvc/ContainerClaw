/**
 * Web search and fetch tools.
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { Tool } from "./base.ts";

const MAX_OUTPUT = 10_000;

interface BraveSearchResult {
  title: string;
  url: string;
  description?: string;
}

interface BraveSearchResponse {
  web?: {
    results?: BraveSearchResult[];
  };
}

export class WebSearchTool implements Tool {
  name = "web_search";
  description = "Search the web using Brave Search API.";
  parameters = {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query." },
      count: {
        type: "number",
        description: "Number of results to return (default 5).",
      },
    },
    required: ["query"],
  };

  constructor(private apiKey?: string) {}

  async execute(args: Record<string, unknown>): Promise<string> {
    if (!this.apiKey) {
      return "Web search not configured";
    }

    const query = String(args.query);
    const count = typeof args.count === "number" ? args.count : 5;

    const url =
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Brave Search API error: ${response.status} ${response.statusText}`,
      );
    }

    const data: BraveSearchResponse = await response.json();
    const results = data.web?.results ?? [];

    if (results.length === 0) {
      return "No results found.";
    }

    return results
      .map((r, i) =>
        `${i + 1}. ${r.title}\n   URL: ${r.url}${r.description ? `\n   ${r.description}` : ""}`
      )
      .join("\n\n");
  }
}

export class WebFetchTool implements Tool {
  name = "web_fetch";
  description = "Fetch and extract the main text content from a URL.";
  parameters = {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to fetch." },
    },
    required: ["url"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const url = String(args.url);
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`URL scheme must be http or https, got "${parsed.protocol}"`);
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Fetch error: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();

    // Use linkedom to parse and readability to extract article text.
    // deno-lint-ignore no-explicit-any
    const { document } = parseHTML(html) as any;
    const reader = new Readability(document);
    const article = reader.parse();

    const text = article?.textContent ?? html;
    const trimmed = text.trim();

    if (trimmed.length > MAX_OUTPUT) {
      return trimmed.slice(0, MAX_OUTPUT) + "\n[content truncated]";
    }
    return trimmed;
  }
}
