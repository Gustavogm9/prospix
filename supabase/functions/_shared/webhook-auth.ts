type EvolutionWebhookCredentials = {
  authorization?: string | null;
  webhookHeader?: string | null;
  webhookQuery?: string | null;
};

type EvolutionWebhookSecrets = {
  serviceRoleKey?: string | null;
  webhookSecret?: string | null;
};

function constantTimeEqual(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = String(left || '');
  const b = String(right || '');
  if (!a || !b || a.length !== b.length) return false;

  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function bearerToken(value: string | null | undefined): string {
  const match = String(value || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

export function isEvolutionWebhookAuthorized(
  credentials: EvolutionWebhookCredentials,
  secrets: EvolutionWebhookSecrets,
): boolean {
  if (constantTimeEqual(bearerToken(credentials.authorization), secrets.serviceRoleKey)) {
    return true;
  }

  return (
    constantTimeEqual(credentials.webhookHeader, secrets.webhookSecret) ||
    constantTimeEqual(credentials.webhookQuery, secrets.webhookSecret)
  );
}
