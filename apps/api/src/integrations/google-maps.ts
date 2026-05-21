import { Result } from '@prospix/shared-types';
import { ResultHelper } from '../lib/result.js';
import { logger } from '../lib/logger.js';

export interface PlaceResult {
  placeId: string;
  name: string;
  formattedAddress: string;
  nationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
}

export type PlaceDetailedResult = PlaceResult;

// Simple Token Bucket Rate Limiter to respect the 100 QPS rate limit
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private maxTokens: number;
  private refillRate: number; // tokens per ms

  constructor(maxTokens: number, refillRatePerSecond: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRatePerSecond / 1000;
    this.lastRefill = Date.now();
  }

  private refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  async acquire(tokens = 1): Promise<void> {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return;
    }
    const needed = tokens - this.tokens;
    const waitMs = needed / this.refillRate;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.refill();
    this.tokens -= tokens;
  }
}

// Instantiate rate limiter for Google Maps API (max 100 QPS)
const mapsLimiter = new TokenBucket(100, 100);

export async function searchPlaces(params: {
  query: string;
  apiKey: string;
  maxResults?: number;
}): Promise<Result<PlaceResult[]>> {
  await mapsLimiter.acquire();

  const url = 'https://places.googleapis.com/v1/places:searchText';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': params.apiKey,
    // Field mask configured to return only necessary fields, reducing API cost
    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.rating,places.userRatingCount,places.types',
  };

  const body = {
    textQuery: params.query,
    maxResultCount: params.maxResults || 20,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (response.status === 403 || response.status === 401) {
      logger.error({ status: response.status, query: params.query }, 'Google Places API auth/billing error');
      return ResultHelper.failure({
        code: 'EXTERNAL_SERVICE_DOWN',
        message: 'Google Places API auth or billing error. Service is unavailable.',
      });
    }

    if (!response.ok) {
      logger.error({ status: response.status, query: params.query }, 'Google Places API request failed');
      return ResultHelper.failure({
        code: 'EXTERNAL_SERVICE_DOWN',
        message: `Google Places API returned status ${response.status}`,
      });
    }

    const data = (await response.json()) as any;
    const places = data.places || [];

    const results: PlaceResult[] = places.map((place: any) => ({
      placeId: place.place_id || place.id,
      name: place.displayName?.text || '',
      formattedAddress: place.formattedAddress || '',
      nationalPhoneNumber: place.nationalPhoneNumber,
      rating: place.rating,
      userRatingCount: place.userRatingCount,
      types: place.types,
    }));

    return ResultHelper.success(results);
  } catch (err: any) {
    logger.error({ err, query: params.query }, 'Exception calling Google Places API');
    return ResultHelper.failure({
      code: 'EXTERNAL_SERVICE_DOWN',
      message: err.message || 'Failed to communicate with Google Places API',
    });
  }
}

export async function getPlaceDetails(params: {
  placeId: string;
  apiKey: string;
}): Promise<Result<PlaceDetailedResult>> {
  await mapsLimiter.acquire();

  const url = `https://places.googleapis.com/v1/places/${params.placeId}`;
  const headers: Record<string, string> = {
    'X-Goog-Api-Key': params.apiKey,
    'X-Goog-FieldMask': 'id,displayName,formattedAddress,nationalPhoneNumber,rating,userRatingCount,types',
  };

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
    });

    if (response.status === 403 || response.status === 401) {
      logger.error({ status: response.status, placeId: params.placeId }, 'Google Places Details API auth/billing error');
      return ResultHelper.failure({
        code: 'EXTERNAL_SERVICE_DOWN',
        message: 'Google Places Details API auth or billing error. Service is unavailable.',
      });
    }

    if (response.status === 404) {
      return ResultHelper.failure({
        code: 'RESOURCE_NOT_FOUND',
        message: `Place with ID ${params.placeId} not found`,
      });
    }

    if (!response.ok) {
      logger.error({ status: response.status, placeId: params.placeId }, 'Google Places Details API request failed');
      return ResultHelper.failure({
        code: 'EXTERNAL_SERVICE_DOWN',
        message: `Google Places Details API returned status ${response.status}`,
      });
    }

    const place = (await response.json()) as any;

    const result: PlaceDetailedResult = {
      placeId: place.place_id || place.id,
      name: place.displayName?.text || '',
      formattedAddress: place.formattedAddress || '',
      nationalPhoneNumber: place.nationalPhoneNumber,
      rating: place.rating,
      userRatingCount: place.userRatingCount,
      types: place.types,
    };

    return ResultHelper.success(result);
  } catch (err: any) {
    logger.error({ err, placeId: params.placeId }, 'Exception calling Google Places Details API');
    return ResultHelper.failure({
      code: 'EXTERNAL_SERVICE_DOWN',
      message: err.message || 'Failed to communicate with Google Places Details API',
    });
  }
}
