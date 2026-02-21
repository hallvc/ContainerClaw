/**
 * Web fetch tool.
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { Tool } from "./base.ts";

const MAX_OUTPUT = 10_000;

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
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
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
