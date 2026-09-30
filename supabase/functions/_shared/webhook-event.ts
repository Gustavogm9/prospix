export function resolveEvolutionWebhookEvent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'MESSAGES_UPSERT';

  const event = (payload as { event?: unknown }).event;
  return typeof event === 'string' && event.trim() ? event : 'MESSAGES_UPSERT';
}
