import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { searchPlaces, getPlaceDetails } from '../../src/integrations/google-maps.js';
import { googleMapsHandlers } from '../../../../packages/mocks/src/google-maps.js';

// Setup MSW mock server with the standard handlers
const server = setupServer(...googleMapsHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Google Places API Integration', () => {
  const apiKey = 'test-api-key-123';

  it('should successfully search for places and map fields', async () => {
    const result = await searchPlaces({
      query: 'cardiologista São José do Rio Preto',
      apiKey,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      const doc = result.value[0]!;
      expect(doc.placeId).toBe('mock_place_001');
      expect(doc.name).toContain('Dr. Roberto Lima');
      expect(doc.formattedAddress).toContain('Av. Brigadeiro Faria Lima');
      expect(doc.nationalPhoneNumber).toBe('(17) 3232-1010');
      expect(doc.rating).toBe(4.7);
      expect(doc.userRatingCount).toBe(184);
      expect(doc.types).toContain('doctor');
    }
  });

  it('should propagate 403 billing/authorization error as EXTERNAL_SERVICE_DOWN', async () => {
    // Override handler to simulate 403
    server.use(
      http.post('https://places.googleapis.com/v1/places:searchText', () => {
        return new HttpResponse(null, { status: 403 });
      })
    );

    const result = await searchPlaces({
      query: 'cardiologista',
      apiKey,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('EXTERNAL_SERVICE_DOWN');
      expect(result.error.message).toContain('auth or billing error');
    }
  });

  it('should successfully get place details', async () => {
    const result = await getPlaceDetails({
      placeId: 'mock_place_002',
      apiKey,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.placeId).toBe('mock_place_002');
      expect(result.value.name).toContain('Dra. Camila Souza');
      expect(result.value.nationalPhoneNumber).toBe('(17) 99887-6622');
      expect(result.value.rating).toBe(4.9);
      expect(result.value.userRatingCount).toBe(92);
    }
  });

  it('should handle 404 Not Found in place details', async () => {
    const result = await getPlaceDetails({
      placeId: 'non_existent_place',
      apiKey,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('RESOURCE_NOT_FOUND');
    }
  });

  it('should handle 403 billing/authorization error in place details', async () => {
    server.use(
      http.get('https://places.googleapis.com/v1/places/:place_id', () => {
        return new HttpResponse(null, { status: 403 });
      })
    );

    const result = await getPlaceDetails({
      placeId: 'mock_place_001',
      apiKey,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('EXTERNAL_SERVICE_DOWN');
    }
  });
});
