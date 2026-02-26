/**
 * Voice transcription using OpenRouter's multimodal chat completions API.
 *
 * Audio is base64-encoded and sent as an `input_audio` content part.
 */

import { encodeBase64 } from "@std/encoding/base64";
import { detectAudioFormat } from "./media.ts";
import type { OpenRouterClient } from "./openrouter_client.ts";

const TRANSCRIPTION_MODEL = "google/gemini-2.5-flash";

/**
 * Download audio from a URL and transcribe it via OpenRouter's chat completions API.
 *
 * @param audioUrl - URL to the audio file (e.g. Telegram file URL)
 * @param client - OpenRouterClient instance
 * @returns Transcribed text, or empty string on any error
 */
export async function transcribe(
  audioUrl: string,
  client: OpenRouterClient,
): Promise<string> {
  try {
    // 1. Download the audio file
    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) {
      console.error(
        `Failed to download audio: HTTP ${audioResponse.status}`,
      );
      return "";
    }
    const audioBytes = new Uint8Array(await audioResponse.arrayBuffer());
    const base64Audio = encodeBase64(audioBytes);
    const format = detectAudioFormat(audioUrl);

    // 2. Send to OpenRouter as chat completion with audio input
    const response = await client.postJSON("/chat/completions", {
      model: TRANSCRIPTION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Transcribe this audio. Return only the transcription, no commentary.",
            },
            {
              type: "input_audio",
              input_audio: { data: base64Audio, format },
            },
          ],
        },
      ],
    });

    if (!response.ok) {
      console.error(
        `OpenRouter transcription error: HTTP ${response.status}`,
      );
      return "";
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Transcription error: ${msg}`);
    return "";
  }
}
