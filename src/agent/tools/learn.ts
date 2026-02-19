/**
 * Learn tool — allows the agent to deliberately save knowledge to persistent memory.
 *
 * Inspired by ClawWork's learn() tool and Clawd's .learnings/ pattern.
 * The agent invokes this when:
 *   - A user corrects a previous behavior
 *   - A non-obvious pattern is discovered
 *   - A preference is stated that should persist forever
 */

import type { Tool } from "./base.ts";
import type { MemoryStore } from "../memory.ts";

const MIN_CONTENT_LENGTH = 100;

export class LearnTool implements Tool {
  name = "learn";
  description =
    "Save important knowledge to persistent memory. Use when corrected by the user, when you discover a non-obvious pattern, or when a preference should be remembered forever. Content must be at least 100 characters.";
  parameters = {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description:
          "Short topic name for the learning (used as filename). Examples: 'asana-workflow', 'deploy-preferences', 'auth-pattern'.",
      },
      content: {
        type: "string",
        description:
          "What was learned. Be specific and actionable. Minimum 100 characters.",
      },
      source: {
        type: "string",
        description:
          "Where this learning came from: 'correction', 'observation', 'preference', or a channel:user identifier.",
      },
    },
    required: ["topic", "content"],
  };

  constructor(private memory: MemoryStore) {}

  async execute(args: Record<string, unknown>): Promise<string> {
    const topic = String(args.topic ?? "").trim();
    const content = String(args.content ?? "").trim();
    const source = String(args.source ?? "observation").trim();

    if (!topic) {
      return "Error: topic is required.";
    }

    if (content.length < MIN_CONTENT_LENGTH) {
      return `Error: content must be at least ${MIN_CONTENT_LENGTH} characters (got ${content.length}). Be more specific about what was learned.`;
    }

    const path = await this.memory.saveLearning({
      topic,
      learned: new Date().toISOString().split("T")[0],
      source,
      content,
    });

    return `Learned "${topic}" and saved to ${path}. This knowledge will be loaded into every future conversation.`;
  }
}
