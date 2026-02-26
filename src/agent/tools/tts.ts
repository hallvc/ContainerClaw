import type { Tool } from "./base.ts";
import type { Storage } from "../../storage/base.ts";

export class TtsTool implements Tool {
  name = "text_to_speech";
  description =
    "Convert text to speech audio. Uploads to storage and returns the URL.";
  parameters = {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Text to convert to speech.",
      },
      voice: {
        type: "string",
        description: "Voice to use. Defaults to 'alloy'.",
      },
    },
    required: ["text"],
  };

  private apiKey: string;
  private model: string;
  private storage: Storage;

  constructor(apiKey: string, model: string, storage: Storage) {
    this.apiKey = apiKey;
    this.model = model;
    this.storage = storage;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const text = String(args.text ?? "");
    const voice = String(args.voice ?? "alloy");

    if (!text) return "Error: text is required.";

    try {
      const response = await fetch(
        "https://openrouter.ai/api/v1/audio/speech",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/containerclaw/containerclaw",
            "X-Title": "containerclaw",
          },
          body: JSON.stringify({
            model: this.model,
            input: text,
            voice,
            response_format: "opus",
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return `Error generating speech: HTTP ${response.status} - ${
          errorText.slice(0, 200)
        }`;
      }

      const audioBytes = new Uint8Array(await response.arrayBuffer());
      const key = this.storage.generateKey("audio", "opus");
      const s3Url = await this.storage.upload(key, audioBytes, "audio/opus");
      return `Speech generated and uploaded: ${s3Url}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error generating speech: ${msg}`;
    }
  }
}
