-- ═══════════════════════════════════════════════════════════════════════════
-- WhatsApp Guardian v2 Migration
-- Adds locked_at column for logical concurrency control and SUSPENDED status
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Adicionar coluna locked_at para lock lógico persistente
ALTER TABLE public.whatsapp_guardian_status 
ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP WITH TIME ZONE;

-- 2. Atualizar restrição de check para incluir status 'SUSPENDED'
ALTER TABLE public.whatsapp_guardian_status 
DROP CONSTRAINT IF EXISTS whatsapp_guardian_status_status_check;

ALTER TABLE public.whatsapp_guardian_status 
ADD CONSTRAINT whatsapp_guardian_status_status_check 
CHECK (status IN ('COLD', 'NORMAL', 'HIGH_LOAD', 'COOLDOWN', 'PAUSED', 'SUSPENDED'));

-- 3. Adicionar coluna is_duplicated na tabela de telemetria
ALTER TABLE public.whatsapp_guardian_telemetry 
ADD COLUMN IF NOT EXISTS is_duplicated BOOLEAN DEFAULT FALSE;

-- 4. Adicionar novos valores no enum LeadStatus
ALTER TYPE public."LeadStatus" ADD VALUE IF NOT EXISTS 'INVALID_NUMBER';
ALTER TYPE public."LeadStatus" ADD VALUE IF NOT EXISTS 'COMMERCIAL_LEAD_SKIPPED';

