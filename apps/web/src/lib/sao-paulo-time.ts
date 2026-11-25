/** Civil date in the business timezone, independent of the browser/server TZ. */
export function saoPauloDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function saoPauloMonth(now = new Date()): string {
  return `${saoPauloDate(now).slice(0, 7)}-01`;
}

/** Half-open interval: include start, exclude next midnight. Brazil uses UTC-3. */
export function saoPauloDayRange(now = new Date()): { start: string; end: string } {
  const start = new Date(`${saoPauloDate(now)}T00:00:00-03:00`);
  return { start: start.toISOString(), end: new Date(start.getTime() + 86400000).toISOString() };
}
