// Handles cache management for card data and similar cards
import { join } from "jsr:@std/path";
import { ensureDir, exists } from "jsr:@std/fs";

export const CACHE_DIR = `${Deno.env.get("HOME")}/.scryfall-mcp-cache`;

export interface SimilarCardData {
  name: string;
  color_identity?: string[];
  cmc?: number;
  type?: string;
  image_uris?: {
    small?: string;
    normal?: string;
  };
}

export interface CardData {
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

interface CachedSimilarCards {
  cards: SimilarCardData[];
  timestamp: string; // ISO string for Temporal API
}

export async function ensureCacheDir(): Promise<void> {
  await ensureDir(CACHE_DIR);
  await ensureDir(join(CACHE_DIR, "similar"));
}

export async function getCachedCard(cardName: string): Promise<CardData | null> {
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

export async function cacheCard(cardName: string, data: CardData): Promise<void> {
  const cachePath = join(CACHE_DIR, `${encodeURIComponent(cardName)}.json`);
  try {
    await Deno.writeTextFile(cachePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Error caching ${cardName}:`, error);
  }
}

export async function getCachedSimilarCards(cardName: string): Promise<SimilarCardData[] | null> {
  const formattedCardName = cardName.toLowerCase().replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  const cachePath = join(CACHE_DIR, "similar", `${formattedCardName}.json`);
  if (await exists(cachePath)) {
    try {
      const content = await Deno.readTextFile(cachePath);
      const cachedData: CachedSimilarCards = JSON.parse(content);
      const cacheDate = Temporal.Instant.from(cachedData.timestamp);
      const now = Temporal.Now.instant();
      const diffInMs = now.epochMilliseconds - cacheDate.epochMilliseconds;
      const diffInDays = diffInMs / (1000 * 60 * 60 * 24);
      if (diffInDays < 365) {
        return cachedData.cards;
      }
      return null;
    } catch (error) {
      console.error(`Error reading similar cards cache for ${cardName}:`, error);
      return null;
    }
  }
  return null;
}

export async function cacheSimilarCards(cardName: string, cards: SimilarCardData[]): Promise<void> {
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
