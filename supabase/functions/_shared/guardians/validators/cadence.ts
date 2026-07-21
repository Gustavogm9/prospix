import type {
  EffectiveGuardian,
  EffectiveGuardianConfig,
  GuardianRunContext,
  GuardianValidationResult,
} from "../types.ts";
import { GuardianReasonCodes } from "../reason-codes.ts";
import { compactEvidence, numberVariable, variableValue } from "../evidence.ts";

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

export type BusinessWindowPlan = {
  allowNow: boolean;
  reason: "inside_business_window" | "before_business_window" | "after_business_window" | "weekend";
  timezone: string;
  evaluated_at: string;
  local_time: string;
  next_scheduled_for: string | null;
  wake_spread_enabled: boolean;
};

export function getGuardianByKey(
  config: EffectiveGuardianConfig | null | undefined,
  guardianKey: string,
): EffectiveGuardian | null {
  return config?.guardians?.find((guardian) => guardian.guardian_key === guardianKey) || null;
}

export function guardianNumber(guardian: EffectiveGuardian | null | undefined, key: string, fallback: number): number {
  if (!guardian) return fallback;
  return numberVariable(guardian, key, fallback);
}

export function guardianString(guardian: EffectiveGuardian | null | undefined, key: string, fallback: string): string {
  if (!guardian) return fallback;
  return String(variableValue(guardian, key, fallback) || fallback);
}

export function deterministicDelaySeconds(seed: string, minSeconds: number, maxSeconds: number): number {
  const min = Math.max(0, Math.floor(minSeconds));
  const max = Math.max(min, Math.floor(maxSeconds));
  if (max === min) return min;
  return min + (hashString(seed) % (max - min + 1));
}

export function computeFirstResponseScheduledFor(
  guardian: EffectiveGuardian | null | undefined,
  nowIso: string,
  seed: string,
): string {
  const minSeconds = guardianNumber(guardian, "first_response_delay_min_seconds", 18);
  const maxSeconds = guardianNumber(guardian, "first_response_delay_max_seconds", 120);
  const delaySeconds = deterministicDelaySeconds(seed, minSeconds, maxSeconds);
  return new Date(new Date(nowIso).getTime() + delaySeconds * 1000).toISOString();
}

export function computeInterBubbleDelaySeconds(
  guardian: EffectiveGuardian | null | undefined,
  seed: string,
): number {
  const minSeconds = guardianNumber(guardian, "inter_bubble_delay_min_seconds", 8);
  const maxSeconds = guardianNumber(guardian, "inter_bubble_delay_max_seconds", 28);
  return deterministicDelaySeconds(seed, minSeconds, maxSeconds);
}

export function computeBusinessWindowPlan(
  guardian: EffectiveGuardian | null | undefined,
  params: {
    nowIso?: string | null;
    scheduledForIso?: string | null;
    bucketKey?: string | null;
  } = {},
): BusinessWindowPlan {
  const timezone = guardianString(guardian, "timezone", "America/Sao_Paulo");
  const businessStart = parseTimeToMinutes(guardianString(guardian, "business_start", "08:00"), 8 * 60);
  const businessEnd = parseTimeToMinutes(guardianString(guardian, "business_end", "20:00"), 20 * 60);
  const wakeStart = parseTimeToMinutes(guardianString(guardian, "wake_spread_start", "08:12"), 8 * 60 + 12);
  const wakeEnd = parseTimeToMinutes(guardianString(guardian, "wake_spread_end", "09:40"), 9 * 60 + 40);
  const wakeBatchMax = Math.max(1, Math.floor(guardianNumber(guardian, "wake_batch_max_per_10min", 2)));
  const skipWeekends = guardian ? variableValue(guardian, "skip_weekends", true) !== false : true;
  const wakeSpreadEnabled = guardian ? variableValue(guardian, "wake_spread_enabled", true) !== false : true;

  const now = parseDate(params.nowIso) || new Date();
  const evaluatedAt = parseDate(params.scheduledForIso) || now;
  const parts = getZonedParts(evaluatedAt, timezone);
  const localMinute = parts.hour * 60 + parts.minute;
  const weekend = skipWeekends && (parts.weekday === 0 || parts.weekday === 6);

  if (!weekend && localMinute >= businessStart && localMinute < businessEnd) {
    return {
      allowNow: true,
      reason: "inside_business_window",
      timezone,
      evaluated_at: evaluatedAt.toISOString(),
      local_time: formatLocalTime(parts),
      next_scheduled_for: null,
      wake_spread_enabled: wakeSpreadEnabled,
    };
  }

  const reason = weekend
    ? "weekend"
    : localMinute < businessStart
      ? "before_business_window"
      : "after_business_window";
  const targetParts = reason === "before_business_window"
    ? nextAllowedBusinessDate(parts, timezone, skipWeekends, 0)
    : nextAllowedBusinessDate(parts, timezone, skipWeekends, 1);
  const wakeSpreadOffset = wakeSpreadEnabled
    ? computeWakeSpreadOffset(wakeStart, wakeEnd, wakeBatchMax, params.bucketKey || evaluatedAt.toISOString())
    : { minute: businessStart, second: 0 };
  let next = zonedDateTimeToUtc(
    targetParts.year,
    targetParts.month,
    targetParts.day,
    Math.floor(wakeSpreadOffset.minute / 60),
    wakeSpreadOffset.minute % 60,
    wakeSpreadOffset.second,
    timezone,
  );

  if (next.getTime() <= now.getTime()) {
    const nextParts = nextAllowedBusinessDate(parts, timezone, skipWeekends, 1);
    const nextDayOffset = wakeSpreadEnabled
      ? computeWakeSpreadOffset(wakeStart, wakeEnd, wakeBatchMax, `${params.bucketKey || ""}:next-day`)
      : { minute: businessStart, second: 0 };
    next = zonedDateTimeToUtc(
      nextParts.year,
      nextParts.month,
      nextParts.day,
      Math.floor(nextDayOffset.minute / 60),
      nextDayOffset.minute % 60,
      nextDayOffset.second,
      timezone,
    );
  }

  return {
    allowNow: false,
    reason,
    timezone,
    evaluated_at: evaluatedAt.toISOString(),
    local_time: formatLocalTime(parts),
    next_scheduled_for: next.toISOString(),
    wake_spread_enabled: wakeSpreadEnabled,
  };
}

export function validateBusinessHoursWakeSpread(
  guardian: EffectiveGuardian,
  context: GuardianRunContext,
): GuardianValidationResult {
  const nowIso = factString(context, "now_iso");
  if (factBoolean(context, "pre_send_current_window_required") === true) {
    const currentPlan = computeBusinessWindowPlan(guardian, {
      nowIso,
      scheduledForIso: nowIso,
      bucketKey: factString(context, "bucket_key")
        || context.pendingOutboundId
        || context.conversationId
        || context.leadId
        || null,
    });

    if (!currentPlan.allowNow) {
      return {
        decision: "DELAY",
        reason_code: GuardianReasonCodes.G18_WAKE_SPREAD_DELAYED,
        confidence: 0.98,
        evidence: compactEvidence({
          ...currentPlan,
          message_type: factString(context, "message_type"),
          current_scheduled_for: factString(context, "current_scheduled_for"),
          evaluation_source: "current_time",
        }),
      };
    }
  }

  const plan = computeBusinessWindowPlan(guardian, {
    nowIso,
    scheduledForIso: factString(context, "scheduled_for"),
    bucketKey: factString(context, "bucket_key")
      || context.pendingOutboundId
      || context.conversationId
      || context.leadId
      || null,
  });

  if (!plan.allowNow) {
    return {
      decision: "DELAY",
      reason_code: GuardianReasonCodes.G18_WAKE_SPREAD_DELAYED,
      confidence: 0.98,
      evidence: compactEvidence({
        ...plan,
        message_type: factString(context, "message_type"),
        current_scheduled_for: factString(context, "current_scheduled_for"),
        evaluation_source: "scheduled_for",
      }),
    };
  }

  return {
    decision: "PASS",
    reason_code: GuardianReasonCodes.G18_WAKE_SPREAD_PASS,
    confidence: 0.98,
    evidence: plan,
  };
}

export function validateContactCadence(
  guardian: EffectiveGuardian,
  context: GuardianRunContext,
): GuardianValidationResult {
  const now = parseDate(factString(context, "now_iso")) || new Date();
  const messageType = (factString(context, "message_type") || "").toUpperCase();
  const lastOutbound = parseDate(factString(context, "last_outbound_sent_at") || factString(context, "last_outbound_at"));
  const lastInbound = parseDate(factString(context, "last_inbound_at"));
  const followupCount = Math.max(0, Math.floor(factNumber(context, "followup_count_without_reply") || 0));
  const activeContacts30m = Math.max(0, Math.floor(factNumber(context, "active_contacts_30m") || 0));
  const maxFollowups = Math.max(0, Math.floor(numberVariable(guardian, "max_followups_without_reply", 2)));
  const minGapHours = Math.max(0, numberVariable(guardian, "same_lead_gap_without_reply_min_hours", 24));
  const activeContactsMax = Math.max(1, Math.floor(numberVariable(guardian, "active_contacts_30m_max", 6)));
  const retryMinutes = 10 + deterministicDelaySeconds(
    context.pendingOutboundId || context.conversationId || context.leadId || "contact-cadence",
    0,
    10,
  );

  if (messageType === "COMMERCIAL_FOLLOWUP" && followupCount >= maxFollowups) {
    return {
      decision: "BLOCK",
      reason_code: GuardianReasonCodes.G20_CONTACT_CADENCE_BLOCKED,
      confidence: 0.98,
      evidence: compactEvidence({
        reasons: ["max_followups_without_reply_reached"],
        message_type: messageType,
        followup_count_without_reply: followupCount,
        max_followups_without_reply: maxFollowups,
      }),
    };
  }

  if (messageType === "COMMERCIAL_FOLLOWUP" && lastOutbound && (!lastInbound || lastInbound.getTime() <= lastOutbound.getTime())) {
    const nextAllowed = new Date(lastOutbound.getTime() + minGapHours * 60 * 60 * 1000);
    if (nextAllowed.getTime() > now.getTime()) {
      return {
        decision: "DELAY",
        reason_code: GuardianReasonCodes.G20_CONTACT_CADENCE_DELAYED,
        confidence: 0.96,
        evidence: compactEvidence({
          reasons: ["same_lead_gap_without_reply_not_met"],
          message_type: messageType,
          last_outbound_sent_at: lastOutbound.toISOString(),
          last_inbound_at: lastInbound?.toISOString() || null,
          min_gap_hours: minGapHours,
          next_scheduled_for: nextAllowed.toISOString(),
        }),
      };
    }
  }

  if (
    ["OUTBOUND_START", "COMMERCIAL_FOLLOWUP"].includes(messageType) &&
    activeContacts30m >= activeContactsMax
  ) {
    return {
      decision: "DELAY",
      reason_code: GuardianReasonCodes.G20_CONTACT_CADENCE_DELAYED,
      confidence: 0.95,
      evidence: compactEvidence({
        reasons: ["active_contacts_30m_limit_reached"],
        message_type: messageType,
        active_contacts_30m: activeContacts30m,
        active_contacts_30m_max: activeContactsMax,
        next_scheduled_for: new Date(now.getTime() + retryMinutes * 60 * 1000).toISOString(),
      }),
    };
  }

  return {
    decision: "PASS",
    reason_code: GuardianReasonCodes.G20_CONTACT_CADENCE_PASS,
    confidence: 0.94,
    evidence: compactEvidence({
      message_type: messageType,
      followup_count_without_reply: followupCount,
      max_followups_without_reply: maxFollowups,
      active_contacts_30m: activeContacts30m,
      active_contacts_30m_max: activeContactsMax,
      last_outbound_sent_at: lastOutbound?.toISOString() || null,
      last_inbound_at: lastInbound?.toISOString() || null,
    }),
  };
}

export function validateConcurrencyLock(
  _guardian: EffectiveGuardian,
  context: GuardianRunContext,
): GuardianValidationResult {
  const now = parseDate(factString(context, "now_iso")) || new Date();
  const lockAcquired = factBoolean(context, "conversation_lock_acquired");
  const lockUntil = parseDate(factString(context, "conversation_lock_until"));
  const activeExternalLock = lockUntil && lockUntil.getTime() > now.getTime() && lockAcquired !== true;

  if (lockAcquired === false || activeExternalLock) {
    return {
      decision: "HARD_BLOCK",
      reason_code: GuardianReasonCodes.G21_CONCURRENCY_LOCK_BLOCKED,
      confidence: 0.99,
      evidence: compactEvidence({
        reasons: lockAcquired === false ? ["conversation_lock_not_acquired"] : ["conversation_already_locked"],
        conversation_lock_until: lockUntil?.toISOString() || null,
        operational_action: "RETRY_WITHOUT_SEND",
      }),
    };
  }

  return {
    decision: "PASS",
    reason_code: GuardianReasonCodes.G21_CONCURRENCY_LOCK_PASS,
    confidence: lockAcquired === true ? 0.99 : 0.86,
    evidence: compactEvidence({
      conversation_lock_acquired: lockAcquired,
      conversation_lock_until: lockUntil?.toISOString() || null,
      lock_fact_present: lockAcquired !== null || lockUntil !== null,
    }),
  };
}

function factString(context: GuardianRunContext, key: string): string | null {
  const value = context.facts?.[key];
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function factNumber(context: GuardianRunContext, key: string): number | null {
  const value = context.facts?.[key];
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function factBoolean(context: GuardianRunContext, key: string): boolean | null {
  const value = context.facts?.[key];
  if (value === true || value === false) return value;
  return null;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseTimeToMinutes(value: string, fallback: number): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return fallback;
  }
  return hour * 60 + minute;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const hour = Number(values.hour) === 24 ? 0 : Number(values.hour);
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour,
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: weekdays[values.weekday] ?? date.getUTCDay(),
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone);
  const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return zonedAsUtc - date.getTime();
}

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second, 0));
  const firstOffset = getTimeZoneOffsetMs(utcGuess, timeZone);
  const firstResult = new Date(utcGuess.getTime() - firstOffset);
  const secondOffset = getTimeZoneOffsetMs(firstResult, timeZone);
  return new Date(utcGuess.getTime() - secondOffset);
}

function nextAllowedBusinessDate(
  parts: ZonedParts,
  timeZone: string,
  skipWeekends: boolean,
  minimumDaysAhead: number,
): ZonedParts {
  for (let daysAhead = minimumDaysAhead; daysAhead <= minimumDaysAhead + 10; daysAhead++) {
    const candidate = getZonedParts(
      zonedDateTimeToUtc(parts.year, parts.month, parts.day + daysAhead, 12, 0, 0, timeZone),
      timeZone,
    );
    if (!skipWeekends || (candidate.weekday !== 0 && candidate.weekday !== 6)) return candidate;
  }
  return getZonedParts(
    zonedDateTimeToUtc(parts.year, parts.month, parts.day + minimumDaysAhead, 12, 0, 0, timeZone),
    timeZone,
  );
}

function computeWakeSpreadOffset(
  startMinute: number,
  endMinute: number,
  batchMax: number,
  seed: string,
): { minute: number; second: number } {
  const normalizedEnd = endMinute > startMinute ? endMinute : startMinute + 10;
  const bucketCount = Math.max(1, Math.ceil((normalizedEnd - startMinute) / 10));
  const slot = hashString(seed) % Math.max(1, bucketCount * batchMax);
  const bucketIndex = Math.floor(slot / batchMax);
  const slotInBucket = slot % batchMax;
  const offsetSeconds = bucketIndex * 600 + Math.floor((slotInBucket * 600) / Math.max(1, batchMax));
  return {
    minute: startMinute + Math.floor(offsetSeconds / 60),
    second: offsetSeconds % 60,
  };
}

function formatLocalTime(parts: ZonedParts): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")} ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}`;
}
