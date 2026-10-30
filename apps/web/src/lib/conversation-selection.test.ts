import { describe, expect, it } from 'vitest';
import { keepSelectedConversation } from './conversation-selection';

const first = { id: 'conversation-1', lastMessage: 'Primeira mensagem' };
const second = { id: 'conversation-2', lastMessage: 'Segunda mensagem' };

describe('keepSelectedConversation', () => {
  it('does not open a conversation when the list loads or refreshes', () => {
    expect(keepSelectedConversation(null, [first, second])).toBeNull();
    expect(keepSelectedConversation(null, [second, first])).toBeNull();
  });

  it('keeps the explicitly selected conversation on refresh', () => {
    const refreshed = { ...second, lastMessage: 'Resposta nova' };
    expect(keepSelectedConversation(second, [first, refreshed])).toBe(refreshed);
  });

  it('closes the drawer when its conversation leaves the list', () => {
    expect(keepSelectedConversation(second, [first])).toBeNull();
  });
});
