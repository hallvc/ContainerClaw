import type { Tool } from "./base.ts";
import type { ExaClient } from "../../providers/exa_client.ts";

export class ExaContentsTool implements Tool {
  name = "exa_contents";
  description =
    "Get clean, parsed content from URLs using Exa's content extraction. Returns page text, title, and metadata.";
  parameters = {
    type: "object",
    properties: {
      urls: {
        type: "array",
        items: { type: "string" },
        description: "URLs to fetch content from.",
      },
      maxCharacters: {
        type: "number",
        description: "Max chars per result. Defaults to 10000.",
      },
      livecrawl: {
        type: "string",
        enum: ["fallback", "preferred"],
        description: "Live crawl mode. Defaults to fallback.",
      },
    },
    required: ["urls"],
  };

  private client: ExaClient;

  constructor(client: ExaClient) {
    this.client = client;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const urls = args.urls as string[];
    const maxCharacters = (args.maxCharacters as number | undefined) ?? 10000;
    const livecrawl = (args.livecrawl as string | undefined) ?? "fallback";

    if (!urls || urls.length === 0) return "Error: urls is required.";

    const response = await this.client.postJSON(
      "/contents",
      { ids: urls, text: { maxCharacters }, livecrawl },
      { timeoutMs: 60_000 },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status} - ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();
    const results = data.results as Array<{
      title?: string;
      url?: string;
      text?: string;
    }>;

    if (!results || results.length === 0) return "No content returned.";

    return results
      .map((r) => `## ${r.title ?? "Untitled"}\n${r.url ?? ""}\n\n${r.text ?? ""}`)
      .join("\n\n---\n\n");
  }
}
