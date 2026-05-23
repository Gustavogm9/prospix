function normalizeJobIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

export function createSendWhatsappJobId(tenantId: string, messageId: string): string {
  return `send-whatsapp-${normalizeJobIdPart(tenantId)}-${normalizeJobIdPart(messageId)}`;
}

export function createRescheduledSendWhatsappJobId(
  tenantId: string,
  messageId: string,
  runAtMs: number
): string {
  const minuteBucket = Math.ceil(runAtMs / 60_000);
  return `${createSendWhatsappJobId(tenantId, messageId)}-retry-${minuteBucket}`;
}
