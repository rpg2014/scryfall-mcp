// ScryfallClient: Handles Scryfall API logic
import { RateLimitedFetcher } from "./rate_limited_fetcher.ts";
import {
  CardData,
  SimilarCardData,
  getCachedCard,
  cacheCard,
  getCachedSimilarCards,
  cacheSimilarCards
} from "./cache.ts";
import { McpError, ErrorCode } from "npm:@modelcontextprotocol/sdk/types.js";

export interface SearchCardsArgs {
  query: string;
  max_results?: number;
  unique?: 'cards' | 'art' | 'prints';
  order?: 'name' | 'set' | 'released' | 'rarity' | 'color' | 'usd' | 'tix' | 'eur' | 'cmc' | 'power' | 'toughness' | 'edhrec' | 'penny' | 'artist' | 'review';
  include_extras?: boolean;
}

export interface SearchResult {
  object: string;
  total_cards: number;
  has_more: boolean;
  next_page?: string;
  data: CardData[];
}

export class ScryfallClient {
  private fetcher = new RateLimitedFetcher();

  async getCardByName(cardName: string): Promise<CardData> {
    const cachedCard = await getCachedCard(cardName);
    if (cachedCard) return cachedCard;
    const url = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName)}`;
    try {
      const response = await this.fetcher.fetch(url);
      if (!response.ok) throw new Error(`Scryfall API error: ${response.status} ${response.statusText}`);
      const data = await response.json();
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
      await cacheCard(cardName, cardData);
      return cardData;
    } catch (error: unknown) {
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
      if (!response.ok) throw new Error(`Scryfall API error: ${response.status} ${response.statusText}`);
      const data = await response.json();
      return data.data.map((obj: { oracle_id: any; source: any; comment: any; }) => ({
        oracle_id: obj.oracle_id,
        source: obj.source,
        comment: obj.comment,
      })) || [];
    } catch (error: unknown) {
      return [];
    }
  }

  async getSimilarCards(cardName: string): Promise<SimilarCardData[]> {
    try {
      const cachedSimilarCards = await getCachedSimilarCards(cardName);
      if (cachedSimilarCards) return cachedSimilarCards;
      const formattedCardName = cardName.toLowerCase().replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
      const url = `https://json.edhrec.com/pages/commanders/${formattedCardName}.json`;
      const response = await this.fetcher.fetch(url);
      if (!response.ok) return [];
      const data = await response.json();
      const similarCards: SimilarCardData[] = [];
      if (data.similar && Array.isArray(data.similar)) {
        for (const card of data.similar) {
          if (card && card.name) {
            const similarCard: SimilarCardData = {
              name: card.name,
              color_identity: card.color_identity,
              cmc: card.cmc,
              type: card.primary_type || card.type,
            };
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
      await cacheSimilarCards(cardName, similarCards);
      return similarCards;
    } catch (error: unknown) {
      return [];
    }
  }

  async searchCards(args: SearchCardsArgs): Promise<SearchResult> {
    try {
      const params = new URLSearchParams({
        q: args.query,
        unique: args.unique || 'cards',
        order: args.order || 'name',
        format: 'json'
      });
      if (args.include_extras) params.set('include_extras', 'true');
      const url = `https://api.scryfall.com/cards/search?${params.toString()}`;
      const response = await this.fetcher.fetch(url);
      if (!response.ok) {
        if (response.status === 404) {
          return { object: 'list', total_cards: 0, has_more: false, data: [] };
        }
        throw new Error(`Scryfall API error: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search cards: ${errorMessage}`
      );
    }
  }
}
