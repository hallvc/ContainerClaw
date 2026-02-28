import type { Tool } from "./base.ts";
import type { ExaClient } from "../../providers/exa_client.ts";

export class ExaFindSimilarTool implements Tool {
  name = "exa_find_similar";
  description =
    "Find web pages similar to a given URL using Exa's semantic similarity.";
  parameters = {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The reference URL to find similar pages for.",
      },
      numResults: {
        type: "number",
        description: "Number of results. Defaults to 10.",
      },
      includeDomains: {
        type: "array",
        items: { type: "string" },
        description: "Limit to specific domains.",
      },
      excludeDomains: {
        type: "array",
        items: { type: "string" },
        description: "Exclude specific domains.",
      },
    },
    required: ["url"],
  };

  private client: ExaClient;

  constructor(client: ExaClient) {
    this.client = client;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const url = String(args.url ?? "");
    const numResults = (args.numResults as number | undefined) ?? 10;
    const includeDomains = args.includeDomains as string[] | undefined;
    const excludeDomains = args.excludeDomains as string[] | undefined;

    if (!url) return "Error: url is required.";

    const body: Record<string, unknown> = { url, numResults };
    if (includeDomains && includeDomains.length > 0) body.includeDomains = includeDomains;
    if (excludeDomains && excludeDomains.length > 0) body.excludeDomains = excludeDomains;

    const response = await this.client.postJSON("/findSimilar", body);

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

    if (!results || results.length === 0) return "No similar pages found.";

    return results
      .map((r, i) =>
        `${i + 1}. ${r.title ?? "Untitled"}\n   ${r.url ?? ""}\n   ${r.text?.slice(0, 200) ?? ""}`
      )
      .join("\n\n");
  }
}
