// =============================================================================
// Prospix · Standalone Enums (ORM-agnostic)
// =============================================================================
// Extracted from Prisma schema to decouple from @prisma/client.
// These are the source of truth — used by API, web, admin, and shared-types.
// =============================================================================

// ── Tenant ──────────────────────────────────────────────────────────────────

export const TenantStatus = {
  ONBOARDING: 'ONBOARDING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  CHURNING: 'CHURNING',
  CHURNED: 'CHURNED',
} as const;
export type TenantStatus = (typeof TenantStatus)[keyof typeof TenantStatus];

export const TenantPlan = {
  STARTER: 'STARTER',
  STANDARD: 'STANDARD',
  PREMIUM: 'PREMIUM',
} as const;
export type TenantPlan = (typeof TenantPlan)[keyof typeof TenantPlan];

// ── User ────────────────────────────────────────────────────────────────────

export const UserRole = {
  OWNER: 'OWNER',
  ASSISTANT: 'ASSISTANT',
  GUILDS_ADMIN: 'GUILDS_ADMIN',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

// ── AI ──────────────────────────────────────────────────────────────────────

export const AIProvider = {
  GUILDS_SHARED: 'GUILDS_SHARED',
  TENANT_OWN: 'TENANT_OWN',
} as const;
export type AIProvider = (typeof AIProvider)[keyof typeof AIProvider];

// ── Campaign ────────────────────────────────────────────────────────────────

export const CampaignStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type CampaignStatus = (typeof CampaignStatus)[keyof typeof CampaignStatus];

// ── Profession ──────────────────────────────────────────────────────────────

export const Profession = {
  DOCTOR: 'DOCTOR',
  LAWYER: 'LAWYER',
  DENTIST: 'DENTIST',
  ENTREPRENEUR: 'ENTREPRENEUR',
  ENGINEER: 'ENGINEER',
  ARCHITECT: 'ARCHITECT',
  ACCOUNTANT: 'ACCOUNTANT',
  OTHER: 'OTHER',
} as const;
export type Profession = (typeof Profession)[keyof typeof Profession];

// ── Lead ────────────────────────────────────────────────────────────────────

export const LeadSource = {
  GOOGLE_MAPS: 'GOOGLE_MAPS',
  RECEITA_FEDERAL: 'RECEITA_FEDERAL',
  CRM_SP: 'CRM_SP',
  OAB_SP: 'OAB_SP',
  CRO_SP: 'CRO_SP',
  LINKEDIN: 'LINKEDIN',
  REFERRAL: 'REFERRAL',
  LANDING_PAGE: 'LANDING_PAGE',
  MANUAL: 'MANUAL',
  IMPORTED: 'IMPORTED',
} as const;
export type LeadSource = (typeof LeadSource)[keyof typeof LeadSource];

export const LeadStatus = {
  CAPTURED: 'CAPTURED',
  ENRICHED: 'ENRICHED',
  CONTACTED: 'CONTACTED',
  NO_RESPONSE: 'NO_RESPONSE',
  CONVERSING: 'CONVERSING',
  QUALIFIED: 'QUALIFIED',
  MEETING_SCHEDULED: 'MEETING_SCHEDULED',
  CLOSED_WON: 'CLOSED_WON',
  CLOSED_LOST: 'CLOSED_LOST',
  NOT_INTERESTED: 'NOT_INTERESTED',
  LOST_BEFORE_MEETING: 'LOST_BEFORE_MEETING',
  OPTED_OUT: 'OPTED_OUT',
  ARCHIVED: 'ARCHIVED',
  ESCALATED_HUMAN: 'ESCALATED_HUMAN',
} as const;
export type LeadStatus = (typeof LeadStatus)[keyof typeof LeadStatus];

// ── Conversation ────────────────────────────────────────────────────────────

export const ConversationStatus = {
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  ESCALATED: 'ESCALATED',
  CLOSED: 'CLOSED',
} as const;
export type ConversationStatus = (typeof ConversationStatus)[keyof typeof ConversationStatus];

// ── Message ─────────────────────────────────────────────────────────────────

export const MessageDirection = {
  INBOUND: 'INBOUND',
  OUTBOUND: 'OUTBOUND',
} as const;
export type MessageDirection = (typeof MessageDirection)[keyof typeof MessageDirection];

export const MessageSender = {
  AI: 'AI',
  USER: 'USER',
  LEAD: 'LEAD',
} as const;
export type MessageSender = (typeof MessageSender)[keyof typeof MessageSender];

export const MessageDeliveryStatus = {
  QUEUED: 'QUEUED',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  FAILED: 'FAILED',
} as const;
export type MessageDeliveryStatus = (typeof MessageDeliveryStatus)[keyof typeof MessageDeliveryStatus];

// ── Meeting ─────────────────────────────────────────────────────────────────

export const MeetingStatus = {
  SCHEDULED: 'SCHEDULED',
  CONFIRMED: 'CONFIRMED',
  HAPPENED: 'HAPPENED',
  NO_SHOW: 'NO_SHOW',
  RESCHEDULED: 'RESCHEDULED',
  CANCELLED: 'CANCELLED',
} as const;
export type MeetingStatus = (typeof MeetingStatus)[keyof typeof MeetingStatus];

export const MeetingOutcome = {
  CLOSED: 'CLOSED',
  SECOND_MEETING: 'SECOND_MEETING',
  NOT_INTERESTED: 'NOT_INTERESTED',
  THINKING: 'THINKING',
} as const;
export type MeetingOutcome = (typeof MeetingOutcome)[keyof typeof MeetingOutcome];

// ── Script ──────────────────────────────────────────────────────────────────

export const ScriptCategory = {
  APPROACH: 'APPROACH',
  OBJECTION: 'OBJECTION',
  EDUCATION: 'EDUCATION',
  CLOSING: 'CLOSING',
  FOLLOW_UP: 'FOLLOW_UP',
  REFERRAL: 'REFERRAL',
  REACTIVATION: 'REACTIVATION',
} as const;
export type ScriptCategory = (typeof ScriptCategory)[keyof typeof ScriptCategory];

export const ScriptStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;
export type ScriptStatus = (typeof ScriptStatus)[keyof typeof ScriptStatus];

// ── Billing ─────────────────────────────────────────────────────────────────

export const BillingStatus = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  REFUNDED: 'REFUNDED',
  WAIVED: 'WAIVED',
} as const;
export type BillingStatus = (typeof BillingStatus)[keyof typeof BillingStatus];

// ── Prompt ──────────────────────────────────────────────────────────────────

export const PromptType = {
  SYSTEM: 'SYSTEM',
  CLASSIFIER: 'CLASSIFIER',
  GUARDRAIL_CORRECTIVE: 'GUARDRAIL_CORRECTIVE',
  FOLLOW_UP: 'FOLLOW_UP',
} as const;
export type PromptType = (typeof PromptType)[keyof typeof PromptType];

// ── Notification ────────────────────────────────────────────────────────────

export const NotificationChannel = {
  PUSH: 'PUSH',
  WHATSAPP: 'WHATSAPP',
  EMAIL: 'EMAIL',
  SMS: 'SMS',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

// ── LGPD ────────────────────────────────────────────────────────────────────

export const LgpdRequestType = {
  EXPORT_DATA: 'EXPORT_DATA',
  DELETE_TENANT_DATA: 'DELETE_TENANT_DATA',
  DELETE_LEAD_DATA: 'DELETE_LEAD_DATA',
  CORRECT_DATA: 'CORRECT_DATA',
  CONFIRM_DATA: 'CONFIRM_DATA',
} as const;
export type LgpdRequestType = (typeof LgpdRequestType)[keyof typeof LgpdRequestType];

export const LgpdRequestStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED',
  CANCELED: 'CANCELED',
} as const;
export type LgpdRequestStatus = (typeof LgpdRequestStatus)[keyof typeof LgpdRequestStatus];

// ── Discovery ───────────────────────────────────────────────────────────────

export const DiscoveryStatus = {
  NOT_STARTED: 'NOT_STARTED',
  SCHEDULED: 'SCHEDULED',
  IN_SESSION: 'IN_SESSION',
  CONSOLIDATING: 'CONSOLIDATING',
  VALIDATING: 'VALIDATING',
  APPROVED: 'APPROVED',
  CHURNED_BEFORE_APPROVAL: 'CHURNED_BEFORE_APPROVAL',
} as const;
export type DiscoveryStatus = (typeof DiscoveryStatus)[keyof typeof DiscoveryStatus];

// ── Alerts ──────────────────────────────────────────────────────────────────

export const AlertSeverity = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
} as const;
export type AlertSeverity = (typeof AlertSeverity)[keyof typeof AlertSeverity];
