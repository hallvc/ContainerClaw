/**
 * Voice transcription using OpenRouter's multimodal chat completions API.
 *
 * Audio is base64-encoded and sent as an `input_audio` content part.
 */

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const TRANSCRIPTION_MODEL = "google/gemini-2.5-flash";

/**
 * Detect audio format from URL file extension.
 */
function detectFormat(url: string): string {
  const ext = url.split(".").pop()?.split("?")[0]?.toLowerCase();
  const formats: Record<string, string> = {
    wav: "wav",
    mp3: "mp3",
    aiff: "aiff",
    aac: "aac",
    ogg: "ogg",
    oga: "ogg",
    flac: "flac",
    m4a: "m4a",
  };
  return formats[ext ?? ""] ?? "ogg";
}

/**
 * Download audio from a URL and transcribe it via OpenRouter's chat completions API.
 *
 * @param audioUrl - URL to the audio file (e.g. Telegram file URL)
 * @param apiKey - OpenRouter API key
 * @returns Transcribed text, or empty string on any error
 */
export async function transcribe(
  audioUrl: string,
  apiKey: string,
): Promise<string> {
  if (!apiKey) {
    console.warn("OpenRouter API key not configured for transcription");
    return "";
  }

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
    const base64Audio = btoa(String.fromCharCode(...audioBytes));
    const format = detectFormat(audioUrl);

    // 2. Send to OpenRouter as chat completion with audio input
    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/containerclaw/containerclaw",
        "X-Title": "containerclaw",
      },
      body: JSON.stringify({
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
      }),
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
