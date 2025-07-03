// Provides a rate-limited fetcher for API requests
const RATE_LIMIT_MS = 75; // 75ms between requests
const USER_AGENT = "MCP-Scryfall-Client/1.0";

export class RateLimitedFetcher {
  private lastFetchTime = 0;

  async fetch(url: string): Promise<Response> {
    const now = Date.now();
    const timeSinceLastFetch = now - this.lastFetchTime;
    if (timeSinceLastFetch < RATE_LIMIT_MS) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS - timeSinceLastFetch));
    }
    this.lastFetchTime = Date.now();
    return fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json"
      }
    });
  }
}
