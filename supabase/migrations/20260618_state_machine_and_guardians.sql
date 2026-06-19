-- ═══════════════════════════════════════════════════════════════════════════
-- State Machine & Guardians Configuration Migration
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Adicionar coluna current_node_id em conversations
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS current_node_id TEXT;
COMMENT ON COLUMN public.conversations.current_node_id IS 'ID do nó ativo do fluxograma na máquina de estados';

-- 2. Adicionar coluna guardians_config em scripts
ALTER TABLE public.scripts ADD COLUMN IF NOT EXISTS guardians_config JSONB DEFAULT '{}'::jsonb NOT NULL;
COMMENT ON COLUMN public.scripts.guardians_config IS 'Configuração de toggles e parâmetros dos guardiões da IA';
