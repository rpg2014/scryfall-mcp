import { assertEquals, assertExists } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { ScryfallServer, ScryfallClient } from "./main.ts";
import { join } from "jsr:@std/path";
import { exists } from "jsr:@std/fs";

// Basic test to ensure the server class can be instantiated
Deno.test("ScryfallServer can be instantiated", () => {
  const server = new ScryfallServer();
  assertExists(server);
});

// Test for the getSimilarCards method
Deno.test("getSimilarCards formats card name correctly", async () => {
  // Create a mock fetcher that returns a predefined response
  const mockFetcher = {
    fetch: async (url: string) => {
      // Verify the URL is formatted correctly
      const expectedUrlPattern = /https:\/\/json\.edhrec\.com\/pages\/commanders\/[a-z0-9-]+\.json/;
      assertEquals(true, expectedUrlPattern.test(url), `URL ${url} should match the expected pattern`);
      
      // Check if the card name is properly formatted in the URL
      // For example, "Omnath, Locus of Rage" should become "omnath-locus-of-rage"
      if (url.includes("omnath-locus-of-rage")) {
        assertEquals(
          "https://json.edhrec.com/pages/commanders/omnath-locus-of-rage.json",
          url,
          "Card name should be properly formatted in the URL"
        );
      }
      
      // Return a mock response
      return {
        ok: true,
        json: async () => ({
          similar: [
            {
              name: "Similar Card 1",
              color_identity: ["R", "G"],
              cmc: 5,
              type: "Legendary Creature",
              image_uris: [
                {
                  small: "https://example.com/small.jpg",
                  normal: "https://example.com/normal.jpg"
                }
              ]
            },
            {
              name: "Similar Card 2",
              color_identity: ["R", "G", "B"],
              cmc: 6,
              type: "Legendary Creature",
              image_uris: [
                {
                  small: "https://example.com/small2.jpg",
                  normal: "https://example.com/normal2.jpg"
                }
              ]
            }
          ]
        })
      };
    }
  };
  
  // Create a ScryfallClient instance directly
  const client = new ScryfallClient();
  
  // Replace the fetcher with our mock
  // Note: This is a bit hacky since we're accessing a private property
  // In a real-world scenario, we would use dependency injection or a proper mocking framework
  Object.defineProperty(client, "fetcher", {
    value: mockFetcher,
    writable: true
  });
  
  // Test with a card name that has spaces and special characters
  const similarCards = await client.getSimilarCards("Omnath, Locus of Rage");
  
  // Verify the results
  assertEquals(2, similarCards.length, "Should return 2 similar cards");
  assertEquals("Similar Card 1", similarCards[0].name);
  assertEquals(["R", "G"], similarCards[0].color_identity);
  assertEquals(5, similarCards[0].cmc);
  assertEquals("Legendary Creature", similarCards[0].type);
  assertEquals("https://example.com/small.jpg", similarCards[0].image_uris?.small);
});

// Test for the caching functionality
Deno.test("getSimilarCards uses and updates cache correctly", async () => {
  // Create a temporary cache directory for testing
  const tempCacheDir = await Deno.makeTempDir({ prefix: "scryfall-test-cache-" });
  const originalCacheDir = Deno.env.get("HOME") + "/.scryfall-mcp-cache";
  
  // Override the CACHE_DIR constant for testing
  // This is a bit hacky, but necessary for testing the cache functionality
  const originalEnvGet = Deno.env.get;
  Deno.env.get = (key: string) => {
    if (key === "HOME") {
      return tempCacheDir;
    }
    return originalEnvGet.call(Deno.env, key);
  };
  
  try {
    // Create a mock fetcher with a spy to track API calls
    const fetchSpy = spy(() => {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          similar: [
            {
              name: "Cached Card Test",
              color_identity: ["R", "G"],
              cmc: 5,
              type: "Legendary Creature",
              image_uris: [
                {
                  small: "https://example.com/cached.jpg",
                  normal: "https://example.com/cached.jpg"
                }
              ]
            }
          ]
        })
      });
    });
    
    const mockFetcher = {
      fetch: fetchSpy
    };
    
    // Create a ScryfallClient instance
    const client = new ScryfallClient();
    
    // Replace the fetcher with our mock
    Object.defineProperty(client, "fetcher", {
      value: mockFetcher,
      writable: true
    });
    
    // First call should fetch from API and create cache
    const firstCallResult = await client.getSimilarCards("Cache Test Card");
    
    // Verify API was called
    assertSpyCalls(fetchSpy, 1);
    assertEquals("Cached Card Test", firstCallResult[0].name);
    
    // Verify cache file was created
    const cachePath = join(tempCacheDir, ".scryfall-mcp-cache", "similar", "cache-test-card.json");
    assertEquals(true, await exists(cachePath), "Cache file should be created");
    
    // Second call should use cache and not call API again
    const secondCallResult = await client.getSimilarCards("Cache Test Card");
    
    // Verify API was not called again
    assertSpyCalls(fetchSpy, 1); // Still just 1 call
    assertEquals("Cached Card Test", secondCallResult[0].name);
    
  } finally {
    // Clean up
    await Deno.remove(tempCacheDir, { recursive: true });
    // Restore original env.get
    Deno.env.get = originalEnvGet;
  }
});
