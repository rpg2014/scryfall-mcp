// ScryfallServer: MCP server implementation using new SDK API
import { McpServer } from "@mcp/sdk/server/mcp.js";
import { StdioServerTransport } from "@mcp/sdk/server/stdio.js";
import { z } from "zod";
import { ensureCacheDir } from "./cache.ts";
import { ScryfallClient, SearchCardsArgs } from "./scryfall_client.ts";
import { ArchidektClient, DeckData } from "./archidekt_client.ts";

export class ScryfallServer {
  private server: McpServer;
  private scryfallClient: ScryfallClient;
  private archidektClient: ArchidektClient;

  constructor() {
    this.server = new McpServer({
      name: "scryfall-server",
      version: "0.2.0",
    });
    
    this.scryfallClient = new ScryfallClient();
    this.archidektClient = new ArchidektClient();
    this.setupTools();
    
    // Handle termination signals
    const handleTermination = async () => {
      await this.server.close();
      Deno.exit(0);
    };
    Deno.addSignalListener("SIGINT", handleTermination);
    Deno.addSignalListener("SIGTERM", handleTermination);
  }

  private setupTools() {
    // Get card data tool
    this.server.tool(
      "get_card_data",
      "Get Magic: The Gathering card data from Scryfall",
      {
        card_names: z.array(z.string()).min(1).describe("List of card names to fetch data for"),
        include_rulings: z.boolean().optional().default(false).describe("Whether to include card rulings"),
        include_similar_cards: z.boolean().optional().default(false).describe("Whether to include a list of similar cards in each response"),
      },
      async ({
        card_names,
        include_rulings,
        include_similar_cards,
      }: {
        card_names: string[];
        include_rulings?: boolean;
        include_similar_cards?: boolean;
      }) => {
        try {
          await ensureCacheDir();
          
          const cardPromises = card_names.map(async (cardName) => {
            const cardData = await this.scryfallClient.getCardByName(cardName);
            let result = { ...cardData };
            
            if (include_rulings && cardData.rulings_uri) {
              const rulings = await this.scryfallClient.getRulings(cardData.rulings_uri);
              result = { ...result, rulings };
            }
            
            if (include_similar_cards) {
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
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text",
                text: `Error fetching card data: ${errorMessage}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // Search cards tool
    this.server.tool(
      "search_cards",
      "Search for Magic: The Gathering cards using Scryfall's search syntax. Supports complex queries including: oracle text (o:), type (t:), color (c:), mana cost (m:), power/toughness (pow:/tou:), rarity (r:), set (s:), format legality (f:), and more. Examples: 'o:\"create\" o:\"token\"' for token generators, 't:equipment' for equipment, 'c:red pow>=4' for big red creatures, 'o:flying t:creature' for flying creatures. Use quotes for multi-word phrases. See Scryfall syntax guide (https://scryfall.com/docs/syntax) for full reference.",
      {
        query: z.string().min(1).describe("Scryfall search query using their syntax (e.g., 'o:\"create\" o:\"token\"', 't:equipment', 'c:red pow>=4')"),
        max_results: z.number().min(1).max(175).optional().default(25).describe("Maximum number of results to return (default: 25, max: 175)"),
        unique: z.enum(["cards", "art", "prints"]).optional().default("cards").describe("How to handle duplicate cards: 'cards' (default, remove duplicates), 'art' (unique artwork), 'prints' (all prints)"),
        order: z.enum(["name", "set", "released", "rarity", "color", "usd", "tix", "eur", "cmc", "power", "toughness", "edhrec", "penny", "artist", "review"]).optional().default("name").describe("How to sort the results (default: 'name')"),
        include_extras: z.boolean().optional().default(false).describe("Include extra cards like tokens and planes"),
      },
      async ({
        query,
        max_results,
        unique,
        order,
        include_extras,
      }: {
        query: string;
        max_results?: number;
        unique?: "cards" | "art" | "prints";
        order?: "name" | "set" | "released" | "rarity" | "color" | "usd" | "tix" | "eur" | "cmc" | "power" | "toughness" | "edhrec" | "penny" | "artist" | "review";
        include_extras?: boolean;
      }) => {
        try {
          await ensureCacheDir();
          
          const searchArgs: SearchCardsArgs = {
            query,
            max_results: max_results ?? 25,
            unique: unique ?? 'cards',
            order: order ?? 'name',
            include_extras: include_extras ?? false,
          };
          
          const searchResult = await this.scryfallClient.searchCards(searchArgs);
          
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
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text",
                text: `Error searching cards: ${errorMessage}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // Get Archidekt deck tool
    this.server.tool(
      "get_archidekt_deck",
      "Fetch a Magic: The Gathering deck from Archidekt and get detailed card information. ",
      {
        deck_id: z.string().min(1).describe("The Archidekt deck ID (from the deck URL)"),
      },
      async ({ deck_id }: { deck_id: string }) => {
        try {
          await ensureCacheDir();
          const deckData = await this.archidektClient.getDeck(deck_id);
          
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(deckData),
              },
            ],
          };
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text",
                text: `Error fetching Archidekt deck: ${errorMessage}`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.log("Scryfall MCP server running on stdio");
  }
}