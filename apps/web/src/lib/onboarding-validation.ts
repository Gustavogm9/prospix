/** Normalize an address before it becomes the owner identity for a tenant. */
export function normalizeOwnerEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || email.length < 6 || /\s/.test(email)) return null;
  const parts = email.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1] || parts[0].length > 64) return null;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(parts[0])) return null;
  const labels = parts[1].split('.');
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
  if (!/^[a-z]{2,63}$/i.test(labels[labels.length - 1] ?? '')) return null;
  return email;
}

/** Resolve the submitted address without assuming a tenant has only one owner. */
export function findUniqueOwnerByEmail<T extends { id: string; email: string }>(
  owners: T[] | null,
  email: string,
): T | null {
  const matching = (owners ?? []).filter((owner) => normalizeOwnerEmail(owner.email) === email);
  return matching.length === 1 ? matching[0] ?? null : null;
}
