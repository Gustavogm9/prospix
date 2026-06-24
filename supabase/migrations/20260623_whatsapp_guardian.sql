-- ═══════════════════════════════════════════════════════════════════════════
-- WhatsApp Guardian Configuration & Telemetry Migration
-- Adds status tracking, dynamic priority queuing, and telemetry logs
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Tabela de Estado do Guardião para cada Instância (Tenant)
CREATE TABLE IF NOT EXISTS public.whatsapp_guardian_status (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'NORMAL' NOT NULL CHECK (status IN ('COLD', 'NORMAL', 'HIGH_LOAD', 'COOLDOWN', 'PAUSED')),
  last_global_send_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- 2. Adicionar novas colunas na tabela public.pending_outbound
ALTER TABLE public.pending_outbound ADD COLUMN IF NOT EXISTS message_type VARCHAR(50);
ALTER TABLE public.pending_outbound ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 3 NOT NULL;

-- 3. Adicionar coluna queued_first_touch_at na tabela public.leads
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS queued_first_touch_at TIMESTAMP WITH TIME ZONE;

-- 4. Tabela de Telemetria/Logs do Guardião
CREATE TABLE IF NOT EXISTS public.whatsapp_guardian_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  message_id UUID,
  conversation_id UUID,
  message_type VARCHAR(50),
  queued_at TIMESTAMP WITH TIME ZONE,
  scheduled_for TIMESTAMP WITH TIME ZONE,
  sent_at TIMESTAMP WITH TIME ZONE,
  delay_applied INTEGER,
  delay_reason TEXT,
  number_state VARCHAR(20),
  queue_position INTEGER,
  is_reactive BOOLEAN,
  is_followup BOOLEAN,
  sent_last_minute INTEGER,
  sent_last_hour INTEGER,
  new_chats_today INTEGER,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- 5. Inicializar registros padrão de whatsapp_guardian_status para tenants existentes
INSERT INTO public.whatsapp_guardian_status (tenant_id)
SELECT id FROM public.tenants
ON CONFLICT (tenant_id) DO NOTHING;
