export function keepSelectedConversation<T extends { id: string }>(
  selected: T | null,
  conversations: T[],
): T | null {
  if (!selected) return null;
  return conversations.find((conversation) => conversation.id === selected.id) ?? null;
}
