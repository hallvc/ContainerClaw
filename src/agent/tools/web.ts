/**
 * Web fetch tool.
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { Tool } from "./base.ts";

const MAX_OUTPUT = 10_000;

/**
 * Returns true if the given hostname resolves to a private/internal network
 * address that should be blocked to prevent SSRF attacks.
 */
export function isPrivateHost(hostname: string): boolean {
  // Strip brackets from IPv6 addresses like [::1]
  const host = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;

  // Exact matches
  if (host === "localhost" || host === "0.0.0.0" || host === "::1") {
    return true;
  }

  // IPv4 range checks
  const ipv4Parts = host.split(".");
  if (ipv4Parts.length === 4 && ipv4Parts.every((p) => /^\d+$/.test(p))) {
    const [a, b] = ipv4Parts.map(Number);
    // 127.0.0.0/8 - loopback
    if (a === 127) return true;
    // 10.0.0.0/8 - Class A private
    if (a === 10) return true;
    // 172.16.0.0/12 - Class B private
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 - Class C private
    if (a === 192 && b === 168) return true;
    // 169.254.0.0/16 - link-local (AWS metadata, etc.)
    if (a === 169 && b === 254) return true;
  }

  // Check IPv4-mapped IPv6 addresses.
  // Dotted-decimal form:  ::ffff:127.0.0.1
  // Hex form (after URL parsing): ::ffff:7f00:1
  if (host.startsWith("::ffff:")) {
    const suffix = host.slice(7);
    // If it looks like dotted-decimal, recurse directly
    if (suffix.includes(".")) {
      return isPrivateHost(suffix);
    }
    // Hex form: two colon-separated 16-bit groups, e.g. "7f00:1"
    const hexParts = suffix.split(":");
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0], 16);
      const lo = parseInt(hexParts[1], 16);
      if (!isNaN(hi) && !isNaN(lo)) {
        const a = (hi >> 8) & 0xff;
        const b = hi & 0xff;
        const c = (lo >> 8) & 0xff;
        const d = lo & 0xff;
        return isPrivateHost(`${a}.${b}.${c}.${d}`);
      }
    }
  }
  // Check for 0 as alias for 0.0.0.0
  if (host === "0") return true;

  return false;
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
    if (isPrivateHost(parsed.hostname)) {
      throw new Error("Blocked: URL points to a private/internal network address (SSRF protection).");
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
