import type { EffectiveGuardian, GuardianVariableValue } from "./types.ts";

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      output[key] = stableNormalize(input[key]);
    }
    return output;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(stableNormalize(value ?? null));
  } catch (_err) {
    return String(value ?? "");
  }
}

export async function sha256Hex(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return "sha256:" + Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function toLoggableText(value: unknown): string {
  if (typeof value === "string") return value;
  return stableStringify(value);
}

export function normalizeText(value: unknown): string {
  return toLoggableText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function redactGuardianText(value: unknown, maxLength = 500): string {
  return toLoggableText(value)
    .replace(/55\d{10,13}/g, "[PHONE_REDACTED]")
    .replace(/\+55\d{10,13}/g, "[PHONE_REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL_REDACTED]")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, "[UUID_REDACTED]")
    .replace(/[A-Za-z0-9_=-]{48,}/g, "[TOKEN_REDACTED]")
    .slice(0, maxLength);
}

export function compactEvidence(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) output[key] = entry;
  }
  return output;
}

export function getVariable(guardian: EffectiveGuardian, key: string): GuardianVariableValue | null {
  return guardian.variables.find((variable) => variable.variable_key === key) || null;
}

export function variableValue<T>(guardian: EffectiveGuardian, key: string, fallback: T): T {
  const variable = getVariable(guardian, key);
  return (variable ? variable.value : fallback) as T;
}

export function stringArrayVariable(guardian: EffectiveGuardian, key: string, fallback: string[] = []): string[] {
  const value = variableValue<unknown>(guardian, key, fallback);
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is string => typeof item === "string");
}

export function numberVariable(guardian: EffectiveGuardian, key: string, fallback: number): number {
  const value = variableValue<unknown>(guardian, key, fallback);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "gi");
  } catch (_err) {
    return null;
  }
}
