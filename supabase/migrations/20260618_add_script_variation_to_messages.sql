-- ═══════════════════════════════════════════════════════════════════════════
-- Script Variation reference in Messages Migration
-- ═══════════════════════════════════════════════════════════════════════════

-- Adicionar coluna script_variation_id em public.messages
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS script_variation_id UUID REFERENCES public.script_variations(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.messages.script_variation_id IS 'ID da variação de roteiro usada para gerar esta mensagem';
