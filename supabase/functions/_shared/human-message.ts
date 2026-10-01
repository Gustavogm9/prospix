const MIN_TYPING_DELAY_MS = 1500;
const MAX_TYPING_DELAY_MS = 6500;
const MS_PER_CHARACTER = 45;

export function calculateHumanTypingDelayMs(
  text: string,
  randomValue = Math.random(),
): number {
  const characters = Array.from(String(text || '')).length;
  const boundedRandom = Math.min(1, Math.max(0, Number(randomValue) || 0));
  const jitterMs = 400 + Math.round(boundedRandom * 800);
  const estimatedMs = characters * MS_PER_CHARACTER + jitterMs;

  return Math.min(MAX_TYPING_DELAY_MS, Math.max(MIN_TYPING_DELAY_MS, estimatedMs));
}

export function formatFitScorePercent(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;

  // Prospix stores fit_score on a 0-10 scale. Values above 10 are kept for
  // backward compatibility with the short-lived 0-100 representation.
  const percent = parsed >= 0 && parsed <= 10 ? parsed * 10 : parsed;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

export function sanitizePromptDatum(value: unknown, maxLength = 160): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(0, maxLength));
}
