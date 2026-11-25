import { describe, expect, it } from 'vitest';
import { saoPauloDayRange, saoPauloMonth } from './sao-paulo-time';

describe('datas operacionais no fuso de São Paulo', () => {
  it('mantém o dia brasileiro quando UTC já virou', () => {
    expect(saoPauloDayRange(new Date('2026-11-20T01:30:00Z'))).toEqual({
      start: '2026-11-19T03:00:00.000Z', end: '2026-11-20T03:00:00.000Z',
    });
  });
  it('usa o mês brasileiro na virada do ano', () => {
    expect(saoPauloMonth(new Date('2027-01-01T01:00:00Z'))).toBe('2026-12-01');
    expect(saoPauloDayRange(new Date('2027-01-01T03:00:00Z')).start).toBe('2027-01-01T03:00:00.000Z');
  });
});
