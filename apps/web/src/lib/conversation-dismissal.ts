/** Keep a successful removal hidden even if an earlier polling response arrives late. */
export function keepVisibleConversations<T extends { id: string }>(
  conversations: T[],
  removedIds: ReadonlySet<string>,
): T[] {
  return conversations.filter((conversation) => !removedIds.has(conversation.id));
}
