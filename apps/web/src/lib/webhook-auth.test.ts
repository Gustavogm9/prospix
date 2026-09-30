import { describe, expect, it } from 'vitest';

import { isEvolutionWebhookAuthorized } from '../../../../supabase/functions/_shared/webhook-auth';

describe('isEvolutionWebhookAuthorized', () => {
  const serviceRoleKey = 'service-role-key';
  const webhookSecret = 'webhook-secret';

  it('accepts trusted internal calls with the service-role bearer token', () => {
    expect(
      isEvolutionWebhookAuthorized(
        { authorization: `Bearer ${serviceRoleKey}` },
        { serviceRoleKey, webhookSecret },
      ),
    ).toBe(true);
  });

  it('accepts the dedicated webhook secret in a header or query parameter', () => {
    expect(
      isEvolutionWebhookAuthorized(
        { webhookHeader: webhookSecret },
        { serviceRoleKey, webhookSecret },
      ),
    ).toBe(true);

    expect(
      isEvolutionWebhookAuthorized(
        { webhookQuery: webhookSecret },
        { serviceRoleKey, webhookSecret },
      ),
    ).toBe(true);
  });

  it('fails closed for missing, invalid, or unconfigured credentials', () => {
    expect(isEvolutionWebhookAuthorized({}, { serviceRoleKey, webhookSecret })).toBe(false);
    expect(
      isEvolutionWebhookAuthorized(
        { webhookQuery: 'wrong-secret' },
        { serviceRoleKey, webhookSecret },
      ),
    ).toBe(false);
    expect(
      isEvolutionWebhookAuthorized(
        { webhookQuery: webhookSecret },
        { serviceRoleKey, webhookSecret: '' },
      ),
    ).toBe(false);
  });
});
