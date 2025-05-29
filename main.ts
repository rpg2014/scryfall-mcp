#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --unstable-temporal
import { Server } from "npm:@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "npm:@modelcontextprotocol/sdk/types.js";
import { join } from "jsr:@std/path";
import { ensureDir, exists } from "jsr:@std/fs";

// Constants
const CACHE_DIR = `${Deno.env.get("HOME")}/.scryfall-mcp-cache`;
const RATE_LIMIT_MS = 75; // 75ms between requests
const USER_AGENT = "MCP-Scryfall-Client/1.0";

// Types
interface CardData {
  name: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  colors?: string[];
  legalities?: Record<string, string>;
  set_name?: string;
  rarity?: string;
  rulings_uri?: string;
  image_uris?: {
    small?: string;
    normal?: string;
  };
  cmc?: number;
  keywords?: string[];
  rulings?: Array<{
    oracle_id: string;
    source: string;
    comment: string;
  }>;
  similar_cards?: SimilarCardData[];
}

interface GetCardDataArgs {
  card_names: string[];
  include_rulings?: boolean;
  include_similar_cards?: boolean;
}

interface SearchCardsArgs {
  query: string;
  max_results?: number;
  unique?: 'cards' | 'art' | 'prints';
  order?: 'name' | 'set' | 'released' | 'rarity' | 'color' | 'usd' | 'tix' | 'eur' | 'cmc' | 'power' | 'toughness' | 'edhrec' | 'penny' | 'artist' | 'review';
  include_extras?: boolean;
}

interface SearchResult {
  object: string;
  total_cards: number;
  has_more: boolean;
  next_page?: string;
  data: CardData[];
}

// Interface for similar card data
interface SimilarCardData {
  name: string;
  color_identity?: string[];
  cmc?: number;
  type?: string;
  image_uris?: {
    small?: string;
    normal?: string;
  };
}

// Cache management
async function ensureCacheDir(): Promise<void> {
  await ensureDir(CACHE_DIR);
  await ensureDir(join(CACHE_DIR, "similar"));
}

async function getCachedCard(cardName: string): Promise<CardData | null> {
  const cachePath = join(CACHE_DIR, `${encodeURIComponent(cardName)}.json`);

  if (await exists(cachePath)) {
    try {
      const content = await Deno.readTextFile(cachePath);
      return JSON.parse(content);
    } catch (error) {
      console.error(`Error reading cache for ${cardName}:`, error);
      return null;
    }
  }

  return null;
}

async function cacheCard(cardName: string, data: CardData): Promise<void> {
  const cachePath = join(CACHE_DIR, `${encodeURIComponent(cardName)}.json`);

  try {
    await Deno.writeTextFile(cachePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Error caching ${cardName}:`, error);
  }
}

interface CachedSimilarCards {
  cards: SimilarCardData[];
  timestamp: string; // ISO string for Temporal API
}

async function getCachedSimilarCards(cardName: string): Promise<SimilarCardData[] | null> {
  const formattedCardName = cardName.toLowerCase().replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  const cachePath = join(CACHE_DIR, "similar", `${formattedCardName}.json`);

  if (await exists(cachePath)) {
    try {
      const content = await Deno.readTextFile(cachePath);
      const cachedData: CachedSimilarCards = JSON.parse(content);
      
      // Check if the cache is older than a year using Temporal API
      const cacheDate = Temporal.Instant.from(cachedData.timestamp);
      const now = Temporal.Now.instant();
      
      // Calculate the difference in milliseconds and convert to days
      const diffInMs = now.epochMilliseconds - cacheDate.epochMilliseconds;
      const diffInDays = diffInMs / (1000 * 60 * 60 * 24);
      
      // If cache is less than 365 days old, use it
      if (diffInDays < 365) {
        return cachedData.cards;
      }
      
      // Cache is too old, return null to fetch fresh data
      return null;
    } catch (error) {
      console.error(`Error reading similar cards cache for ${cardName}:`, error);
      return null;
    }
  }

  return null;
}

async function cacheSimilarCards(cardName: string, cards: SimilarCardData[]): Promise<void> {
  const formattedCardName = cardName.toLowerCase().replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  const cachePath = join(CACHE_DIR, "similar", `${formattedCardName}.json`);

  const cacheData: CachedSimilarCards = {
    cards,
    timestamp: Temporal.Now.instant().toString()
  };

  try {
    await Deno.writeTextFile(cachePath, JSON.stringify(cacheData, null, 2));
  } catch (error) {
    console.error(`Error caching similar cards for ${cardName}:`, error);
  }
}

// Rate-limited fetch
class RateLimitedFetcher {
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

// Scryfall API client
class ScryfallClient {
  private fetcher = new RateLimitedFetcher();

  async getCardByName(cardName: string): Promise<CardData> {
    // Check cache first
    const cachedCard = await getCachedCard(cardName);
    if (cachedCard) {
      return cachedCard;
    }

    // Fetch from API if not in cache
    const url = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName)}`;

    try {
      const response = await this.fetcher.fetch(url);

      if (!response.ok) {
        throw new Error(`Scryfall API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Extract relevant card data
      const cardData: CardData = {
        name: data.name,
        mana_cost: data.mana_cost,
        type_line: data.type_line,
        oracle_text: data.oracle_text,
        power: data.power,
        toughness: data.toughness,
        colors: data.colors,
        legalities: {
          standard: data.legalities?.standard,
          modern: data.legalities?.modern,
          commander: data.legalities?.commander,
        },
        set_name: data.set_name,
        rarity: data.rarity,
        rulings_uri: data.rulings_uri,
        image_uris: {
          small: data.image_uris?.small,
          normal: data.image_uris?.normal,
        },
        cmc: data.cmc,
        keywords: data.keywords
      };

      // Cache the card data
      await cacheCard(cardName, cardData);

      return cardData;
    } catch (error: unknown) {
      console.error(`Error fetching card ${cardName}:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to fetch card data for ${cardName}: ${errorMessage}`
      );
    }
  }

  async getRulings(rulingsUri: string): Promise<any[]> {
    try {
      const response = await this.fetcher.fetch(rulingsUri);

      if (!response.ok) {
        throw new Error(`Scryfall API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.data.map((obj: { oracle_id: any; source: any; comment: any; }) => {
        return {
          oracle_id: obj.oracle_id,
          "source": obj.source,
          comment: obj.comment,
        }
      }) || [];
    } catch (error: unknown) {
      console.error(`Error fetching rulings:`, error);
      return [];
    }
  }

  async getSimilarCards(cardName: string): Promise<SimilarCardData[]> {
    try {
      // Check cache first
      const cachedSimilarCards = await getCachedSimilarCards(cardName);
      if (cachedSimilarCards) {
        return cachedSimilarCards;
      }
      
      // Convert card name to lowercase and replace spaces with dashes
      const formattedCardName = cardName.toLowerCase().replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, ''); // Remove any non-alphanumeric characters except dashes
      
      const url = `https://json.edhrec.com/pages/commanders/${formattedCardName}.json`;
      
      const response = await this.fetcher.fetch(url);
      
      if (!response.ok) {
        console.error(`EDHREC API error: ${response.status} ${response.statusText}`);
        return [];
      }
      
      const data = await response.json();
      
      // Extract similar cards from the response
      const similarCards: SimilarCardData[] = [];
      
      // Check if similar cards data exists
      if (data.similar && Array.isArray(data.similar)) {
        // Process each similar card
        for (const card of data.similar) {
          if (card && card.name) {
            const similarCard: SimilarCardData = {
              name: card.name,
              color_identity: card.color_identity,
              cmc: card.cmc,
              type: card.primary_type || card.type,
            };
            
            // Add image URIs if available
            if (card.image_uris && card.image_uris.length > 0) {
              similarCard.image_uris = {
                small: card.image_uris[0]?.small,
                normal: card.image_uris[0]?.normal,
              };
            }
            
            similarCards.push(similarCard);
          }
        }
      }
      
      // Cache the similar cards data
      await cacheSimilarCards(cardName, similarCards);
      
      return similarCards;
    } catch (error: unknown) {
      console.error(`Error fetching similar cards for ${cardName}:`, error);
      return [];
    }
  }

  async searchCards(args: SearchCardsArgs): Promise<SearchResult> {
    try {
      // Build the URL with parameters
      const params = new URLSearchParams({
        q: args.query,
        unique: args.unique || 'cards',
        order: args.order || 'name',
        format: 'json'
      });
      
      if (args.include_extras) {
        params.set('include_extras', 'true');
      }
      
      const url = `https://api.scryfall.com/cards/search?${params.toString()}`;
      
      const response = await this.fetcher.fetch(url);
      
      if (!response.ok) {
        if (response.status === 404) {
          // No cards found
          return {
            object: 'list',
            total_cards: 0,
            has_more: false,
            data: []
          };
        }
        throw new Error(`Scryfall API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Extract and format card data
      const cards: CardData[] = data.data.slice(0, args.max_results || 25).map((card: any) => ({
        name: card.name,
        mana_cost: card.mana_cost,
        type_line: card.type_line,
        oracle_text: card.oracle_text,
        power: card.power,
        toughness: card.toughness,
        colors: card.colors,
        legalities: {
          standard: card.legalities?.standard,
          modern: card.legalities?.modern,
          commander: card.legalities?.commander,
        },
        set_name: card.set_name,
        rarity: card.rarity,
        rulings_uri: card.rulings_uri,
        image_uris: {
          small: card.image_uris?.small,
          normal: card.image_uris?.normal,
        },
        cmc: card.cmc,
        keywords: card.keywords
      }));
      
      return {
        object: data.object,
        total_cards: data.total_cards,
        has_more: data.has_more,
        next_page: data.next_page,
        data: cards
      };
    } catch (error: unknown) {
      console.error(`Error searching cards:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search cards: ${errorMessage}`
      );
    }
  }
}

// MCP Server implementation
class ScryfallServer {
  private server: Server;
  private scryfallClient: ScryfallClient;

  constructor() {
    this.server = new Server(
      {
        name: "scryfall-server",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.scryfallClient = new ScryfallClient();

    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error) => console.error("[MCP Error]", error);

    // Handle termination
    const handleTermination = async () => {
      await this.server.close();
      Deno.exit(0);
    };

    Deno.addSignalListener("SIGINT", handleTermination);
    Deno.addSignalListener("SIGTERM", handleTermination);
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "get_card_data",
          description: "Get Magic: The Gathering card data from Scryfall",
          inputSchema: {
            type: "object",
            properties: {
              card_names: {
                type: "array",
                items: { type: "string" },
                description: "List of card names to fetch data for",
              },
              include_rulings: {
                type: "boolean",
                description: "Whether to include card rulings",
                default: false,
              },
              include_similar_cards: {
                type: "boolean",
                description: "Whether to include a list of similar cards in each response",
                default: false,
              }
            },
            required: ["card_names"],
          },
        },
        {
          name: "search_cards",
          description: "Search for Magic: The Gathering cards using Scryfall's search syntax. Supports complex queries including: oracle text (o:), type (t:), color (c:), mana cost (m:), power/toughness (pow:/tou:), rarity (r:), set (s:), format legality (f:), and more. Examples: 'o:\"create\" o:\"token\"' for token generators, 't:equipment' for equipment, 'c:red pow>=4' for big red creatures, 'o:flying t:creature' for flying creatures. Use quotes for multi-word phrases. See Scryfall syntax guide (https://scryfall.com/docs/syntax) for full reference.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Scryfall search query using their syntax (e.g., 'o:\"create\" o:\"token\"', 't:equipment', 'c:red pow>=4')",
              },
              max_results: {
                type: "number",
                description: "Maximum number of results to return (default: 25, max: 175)",
                default: 25,
              },
              unique: {
                type: "string",
                enum: ["cards", "art", "prints"],
                description: "How to handle duplicate cards: 'cards' (default, remove duplicates), 'art' (unique artwork), 'prints' (all prints)",
                default: "cards",
              },
              order: {
                type: "string",
                enum: ["name", "set", "released", "rarity", "color", "usd", "tix", "eur", "cmc", "power", "toughness", "edhrec", "penny", "artist", "review"],
                description: "How to sort the results (default: 'name')",
                default: "name",
              },
              include_extras: {
                type: "boolean",
                description: "Include extra cards like tokens and planes",
                default: false,
              }
            },
            required: ["query"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === "get_card_data") {
        return this.handleGetCardData(request);
      } else if (request.params.name === "search_cards") {
        return this.handleSearchCards(request);
      } else {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
      }
    });
  }

  private async handleGetCardData(request: any) {
    // Safely cast arguments with validation
    const rawArgs = request.params.arguments || {};

    // Validate card_names
    if (!rawArgs.card_names || !Array.isArray(rawArgs.card_names) || rawArgs.card_names.length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "card_names must be a non-empty array of strings"
      );
    }

    const args: GetCardDataArgs = {
      card_names: rawArgs.card_names as string[],
      include_rulings: Boolean(rawArgs.include_rulings),
      include_similar_cards: Boolean(rawArgs.include_similar_cards),
    };

    try {
      // Ensure cache directory exists
      await ensureCacheDir();

      // Fetch card data for each name
      const cardPromises = args.card_names.map(async (cardName) => {
        const cardData = await this.scryfallClient.getCardByName(cardName);
        let result = { ...cardData };

        // Fetch rulings if requested and available
        if (args.include_rulings && cardData.rulings_uri) {
          const rulings = await this.scryfallClient.getRulings(cardData.rulings_uri);
          result = { ...result, rulings };
        }

        // Fetch similar cards if requested
        if (args.include_similar_cards) {
          const similarCards = await this.scryfallClient.getSimilarCards(cardName);
          result = { ...result, similar_cards: similarCards };
        }

        return result;
      });

      const cards = await Promise.all(cardPromises);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(cards, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      if (error instanceof McpError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Error fetching card data: ${errorMessage}`
      );
    }
  }

  private async handleSearchCards(request: any) {
    // Safely cast arguments with validation
    const rawArgs = request.params.arguments || {};

    // Validate query
    if (!rawArgs.query || typeof rawArgs.query !== 'string') {
      throw new McpError(
        ErrorCode.InvalidParams,
        "query must be a non-empty string"
      );
    }

    const args: SearchCardsArgs = {
      query: rawArgs.query,
      max_results: rawArgs.max_results ? Number(rawArgs.max_results) : 25,
      unique: rawArgs.unique || 'cards',
      order: rawArgs.order || 'name',
      include_extras: Boolean(rawArgs.include_extras),
    };

    try {
      // Ensure cache directory exists
      await ensureCacheDir();

      const searchResult = await this.scryfallClient.searchCards(args);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              total_cards: searchResult.total_cards,
              has_more: searchResult.has_more,
              cards: searchResult.data
            }, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      if (error instanceof McpError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Error searching cards: ${errorMessage}`
      );
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Scryfall MCP server running on stdio");
  }
}

if (import.meta.main) {
  const server = new ScryfallServer();
  server.run().catch(console.error);
}

export { ScryfallServer, ScryfallClient };
