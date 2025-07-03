// ScryfallServer: MCP server implementation
import { Server } from "npm:@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "npm:@modelcontextprotocol/sdk/types.js";
import { ensureCacheDir } from "./cache.ts";
import { ScryfallClient, SearchCardsArgs } from "./scryfall_client.ts";
import { ArchidektClient, DeckData } from "./archidekt_client.ts";

interface GetCardDataArgs {
  card_names: string[];
  include_rulings?: boolean;
  include_similar_cards?: boolean;
}

export class ScryfallServer {
  private server: Server;
  private scryfallClient: ScryfallClient;
  private archidektClient: ArchidektClient;

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
    this.archidektClient = new ArchidektClient();
    this.setupToolHandlers();
    this.server.onerror = (error) => console.error("[MCP Error]", error);
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
        {
          name: "get_archidekt_deck",
          description: "Fetch a Magic: The Gathering deck from Archidekt and get detailed card information.",
          inputSchema: {
            type: "object",
            properties: {
              deck_id: {
                type: "string",
                description: "The Archidekt deck ID (from the deck URL)",
              }
            },
            required: ["deck_id"],
          },
        },
      ],
    }));
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === "get_card_data") {
        return this.handleGetCardData(request);
      } else if (request.params.name === "search_cards") {
        return this.handleSearchCards(request);
      } else if (request.params.name === "get_archidekt_deck") {
        return this.handleGetArchidektDeck(request);
      } else {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
      }
    });
  }

  private async handleGetCardData(request: any) {
    const rawArgs = request.params.arguments || {};
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
      await ensureCacheDir();
      const cardPromises = args.card_names.map(async (cardName) => {
        const cardData = await this.scryfallClient.getCardByName(cardName);
        let result = { ...cardData };
        if (args.include_rulings && cardData.rulings_uri) {
          const rulings = await this.scryfallClient.getRulings(cardData.rulings_uri);
          result = { ...result, rulings };
        }
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
      if (error instanceof McpError) throw error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Error fetching card data: ${errorMessage}`
      );
    }
  }

  private async handleSearchCards(request: any) {
    const rawArgs = request.params.arguments || {};
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
      if (error instanceof McpError) throw error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Error searching cards: ${errorMessage}`
      );
    }
  }

  private async handleGetArchidektDeck(request: any) {
    const rawArgs = request.params.arguments || {};
    if (!rawArgs.deck_id || typeof rawArgs.deck_id !== 'string') {
      throw new McpError(
        ErrorCode.InvalidParams,
        "deck_id must be a non-empty string"
      );
    }
    
    try {
      await ensureCacheDir();
      const deckData = await this.archidektClient.getDeck(rawArgs.deck_id);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(deckData),
          },
        ],
      };
    } catch (error: unknown) {
      if (error instanceof McpError) throw error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Error fetching Archidekt deck: ${errorMessage}`
      );
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Scryfall MCP server running on stdio");
  }
}
