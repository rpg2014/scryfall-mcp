// ArchidektClient: Handles Archidekt API logic
import { RateLimitedFetcher } from "./rate_limited_fetcher.ts";
import { ScryfallClient } from "./scryfall_client.ts";
import { CardData } from "./cache.ts";
import { McpError, ErrorCode } from "npm:@modelcontextprotocol/sdk/types.js";
     
interface OracleCard {
      name: string;
      manaCost?: string;
      types?: string[]
      text?: string;
      power?: string;
      toughness?: string;
      colors?: string[];
      cmc?: number;
      // keywords?: string[];
    };
export interface ArchidektCard {
  card: {
    oracleCard: OracleCard
  };
  quantity: number;
  categories: string[];
}

export interface ArchidektDeck {
  id: number;
  name: string;
  description?: string;
  format?: string;
  cards: ArchidektCard[];
  owner: {
    username: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface DeckData {
  deck: {
    id: number;
    name: string;
    description: string;
    format: string;
    owner: {
      username: string;
    };
    createdAt: string;
    updatedAt: string;
  };
  cards: (CardData & { quantity: number; categories: {categoryName: string, includedInDeck: boolean}[] })[];
}

export class ArchidektClient {
  private fetcher = new RateLimitedFetcher();
  private scryfallClient = new ScryfallClient();

  async getDeck(deckId: string): Promise<DeckData> {
    try {
      // Fetch deck data from Archidekt API
      const url = `https://archidekt.com/api/decks/${deckId}/`;
      const response = await this.fetcher.fetch(url);
      
      if (!response.ok) {
        throw new Error(`Archidekt API error: ${response.status} ${response.statusText}`);
      }
      
      const deckData = await response.json();
      
      // Extract card names and fetch detailed card data from Scryfall sequentially
      const cardNames = deckData.cards.map((card: ArchidektCard) => card.card.oracleCard.name);
      const uniqueCardNames = [...new Set(cardNames)];

      const cards: (CardData & { quantity: number; categories: {categoryName: string, includedInDeck: boolean}[] })[] = [];
      for (const cardName of uniqueCardNames) {
        const archidektCard: ArchidektCard = deckData.cards.find((card: ArchidektCard) =>
          card.card.oracleCard.name === cardName
        );

        // const oracleCard: OracleCard  = archidektCard?.card.oracleCard;
        // if (oracleCard && oracleCard.manaCost && oracleCard.types && oracleCard.text) {
        //   cards.push({
        // name: oracleCard.name,
        // mana_cost: oracleCard.manaCost,
        // type_line: oracleCard.types.join(" "),
        // oracle_text: oracleCard.text,
        // power: oracleCard.power,
        // toughness: oracleCard.toughness,
        // colors: oracleCard.colors || [],
        // cmc: oracleCard.cmc || 0,
        // quantity: archidektCard.quantity,
        // categories: archidektCard.categories,
        // rulings_uri: undefined,
        // image_uris: { small: undefined, normal: undefined }
        //   } as CardData & { quantity: number; categories: string[] });
        // } else {
          const scryfallData = await this.scryfallClient.getCardByName(cardName as string);
        const categoryList: { id: number, name: string, includedInDeck: boolean }[] = deckData.categories
        cards.push({
          ...scryfallData,
          quantity: archidektCard?.quantity || 1,
          categories: archidektCard?.categories
              .map(categoryName => categoryList.find(category => category.name === categoryName) || { id: 0, name: "Unknown Category", includedInDeck: true })
              .map((category) => ({ categoryName: category.name, includedInDeck: category.includedInDeck })) || []
        });
        // }
      }
      
      // Transform the raw Archidekt response into our clean DeckData format
      //This is probably wrong, but 3 is commander
      const formatMap: { [key: number]: string } = {
        1: "Standard",
        2: "Modern", 
        3: "Commander",
        4: "Vintage",
        5: "Legacy",
        6: "Pioneer",
        7: "Historic",
        8: "Pauper"
      };
      
      return {
        deck: {
          id: deckData.id,
          name: deckData.name,
          description: deckData.description || "",
          format: formatMap[deckData.deckFormat] || "Unknown",
          owner: {
            username: deckData.owner.username
          },
          createdAt: deckData.createdAt,
          updatedAt: deckData.updatedAt
        },
        cards: cards
      };
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to fetch deck from Archidekt: ${errorMessage}`
      );
    }
  }
}
