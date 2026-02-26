const BASE_URL = "https://openrouter.ai/api/v1";

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_INITIAL_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 8000;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface PostJSONOptions {
  timeoutMs?: number;
  accept?: string;
}

/**
 * Retry a fetch call with exponential backoff.
 * - Retries on network errors (fetch throws) and HTTP 429/5xx.
 * - Does NOT retry on HTTP 4xx (except 429).
 * - On exhaustion of retries for 429/5xx, returns the last response so the
 *   caller's existing error-handling branch applies.
 */
async function withRetry(fn: () => Promise<Response>): Promise<Response> {
  let lastNetworkError: unknown;
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fn();

      if (response.status === 429 || response.status >= 500) {
        lastResponse = response;
        if (attempt < RETRY_MAX_ATTEMPTS - 1) {
          const jitter = Math.random() * 200;
          const delay = Math.min(
            RETRY_INITIAL_DELAY_MS * Math.pow(2, attempt) + jitter,
            RETRY_MAX_DELAY_MS,
          );
          console.warn(
            `Retrying after HTTP ${response.status} (attempt ${attempt + 1})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        return lastResponse;
      }

      return response;
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        lastNetworkError = err;
        if (attempt < RETRY_MAX_ATTEMPTS - 1) {
          console.warn(`Retrying after timeout (attempt ${attempt + 1})`);
          await new Promise((resolve) => setTimeout(resolve, RETRY_INITIAL_DELAY_MS));
          continue;
        }
        throw err;
      }
      lastNetworkError = err;
      if (attempt < RETRY_MAX_ATTEMPTS - 1) {
        const jitter = Math.random() * 200;
        const delay = Math.min(
          RETRY_INITIAL_DELAY_MS * Math.pow(2, attempt) + jitter,
          RETRY_MAX_DELAY_MS,
        );
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`Retrying after error (attempt ${attempt + 1}): ${msg}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastNetworkError;
}

/**
 * Low-level HTTP client for the OpenRouter API.
 *
 * Centralises authentication, retry with exponential backoff, and timeout
 * enforcement so that every caller (chat, image gen, TTS, transcription)
 * gets production-grade resilience for free.
 */
export class OpenRouterClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * POST JSON to an OpenRouter API path and return the raw Response.
   *
   * @param path - Relative path, e.g. "/chat/completions" or "/audio/speech"
   * @param body - JSON-serialisable request body
   * @param opts.timeoutMs - Initial response timeout (default 30 s)
   * @param opts.accept - Accept header (default "application/json")
   */
  async postJSON(
    path: string,
    body: Record<string, unknown>,
    opts?: PostJSONOptions,
  ): Promise<Response> {
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const accept = opts?.accept ?? "application/json";

    return await withRetry(() =>
      fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Accept": accept,
          "HTTP-Referer": "https://github.com/containerclaw/containerclaw",
          "X-Title": "containerclaw",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    );
  }
}
