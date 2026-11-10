import { describe, expect, it } from 'vitest';
import { keepVisibleConversations } from './conversation-dismissal';

const first = { id: 'conversation-1' };
const second = { id: 'conversation-2' };

describe('keepVisibleConversations', () => {
  it('keeps a removed conversation hidden when an older refresh finishes late', () => {
    expect(keepVisibleConversations([first, second], new Set([first.id]))).toEqual([second]);
  });

  it('does not hide other conversations from the same lead', () => {
    const sameLead = [{ ...first, leadId: 'lead-1' }, { ...second, leadId: 'lead-1' }];
    expect(keepVisibleConversations(sameLead, new Set([first.id]))).toEqual([sameLead[1]]);
  });
});
