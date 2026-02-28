import type { Tool } from "./base.ts";
import type { ExaClient } from "../../providers/exa_client.ts";

export class ExaAnswerTool implements Tool {
  name = "exa_answer";
  description =
    "Get a direct answer to a question with web citations using Exa. Returns an LLM-generated answer grounded in web sources.";
  parameters = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The question to answer.",
      },
      numResults: {
        type: "number",
        description: "Number of source results to use. Defaults to 5.",
      },
    },
    required: ["query"],
  };

  private client: ExaClient;

  constructor(client: ExaClient) {
    this.client = client;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const query = String(args.query ?? "");
    const numResults = (args.numResults as number | undefined) ?? 5;

    if (!query) return "Error: query is required.";

    const response = await this.client.postJSON(
      "/answer",
      { query, numResults, text: true },
      { timeoutMs: 60_000 },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status} - ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();
    const answer = data.answer as string | undefined;
    const citations = data.citations as Array<{
      title?: string;
      url?: string;
    }> | undefined;

    const parts: string[] = [];
    if (answer) parts.push(answer);
    if (citations && citations.length > 0) {
      const list = citations
        .map((c, i) => `${i + 1}. [${c.title ?? c.url ?? "Source"}](${c.url ?? ""})`)
        .join("\n");
      parts.push(`\n**Sources:**\n${list}`);
    }

    return parts.join("\n\n") || "No answer returned.";
  }
}
