import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { evolutionHandlers } from '@prospix/mocks';
import { createEvolutionClient, validateEvolutionWebhookSignature } from '../../src/integrations/evolution.js';

// Setup MSW Server
const server = setupServer(...evolutionHandlers);

describe('Evolution API Client Integration (with MSW Mock)', () => {
  beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  const client = createEvolutionClient();

  const mockParams = {
    instance: 'tenant_giovane',
    apiKey: 'mock-key',
    baseUrl: 'https://evo.prospix.com.br',
  };

  it('should send a text message successfully', async () => {
    const result = await client.sendText({
      ...mockParams,
      number: '5517998764422',
      text: 'Olá, isso é um teste!',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.messageId).toBeDefined();
      expect(result.value.messageId.startsWith('mock_')).toBe(true);
    }
  });

  it('should fail closed when sendText does not return a provider message id', async () => {
    server.use(
      http.post('*/message/sendText/:instance', () =>
        HttpResponse.json({
          status: 'PENDING',
        })
      )
    );

    const result = await client.sendText({
      ...mockParams,
      number: '5517998764422',
      text: 'Olá, isso é um teste!',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('did not return a message id');
    }
  });

  it('should validate WhatsApp numbers successfully', async () => {
    const result = await client.checkNumbers({
      ...mockParams,
      numbers: ['5517998764422', '123'], // 123 is too short and should fail exist check
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0]?.exists).toBe(true);
      expect(result.value[1]?.exists).toBe(false);
    }
  });

  it('should retrieve connection state successfully', async () => {
    const result = await client.getConnectionState(mockParams);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state).toBe('open');
    }
  });

  it('should validate webhook HMAC signature correctly', () => {
    const payload = JSON.stringify({ event: 'test' });
    const secret = 'webhook-secret';
    // Generate valid hmac-sha256 hex
    const crypto = require('crypto');
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    const isValid = validateEvolutionWebhookSignature(payload, signature, secret);
    expect(isValid).toBe(true);

    const isInvalid = validateEvolutionWebhookSignature(payload, 'wrong-sig', secret);
    expect(isInvalid).toBe(false);
  });
});
