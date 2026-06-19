-- ═══════════════════════════════════════════════════════════════════════════
-- Objections Table Migration
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.objections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    script_id UUID REFERENCES public.scripts(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    pattern TEXT NOT NULL,
    response TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Indexadores para agilizar a busca de objeções por tenant
CREATE INDEX IF NOT EXISTS idx_objections_tenant ON public.objections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_objections_script ON public.objections(script_id);

-- Habilitar RLS
ALTER TABLE public.objections ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS
CREATE POLICY "objections_select" ON public.objections FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "objections_insert" ON public.objections FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "objections_update" ON public.objections FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "objections_delete" ON public.objections FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));
