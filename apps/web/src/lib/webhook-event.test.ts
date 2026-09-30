import { describe, expect, it } from 'vitest';

import { resolveEvolutionWebhookEvent } from '../../../../supabase/functions/_shared/webhook-event';

describe('resolveEvolutionWebhookEvent', () => {
  it('keeps the provider event available inside the asynchronous message processor', () => {
    expect(resolveEvolutionWebhookEvent({ event: 'MESSAGES_UPSERT' })).toBe('MESSAGES_UPSERT');
  });

  it('uses the inbound event fallback when the provider omits the field', () => {
    expect(resolveEvolutionWebhookEvent({})).toBe('MESSAGES_UPSERT');
  });
});
