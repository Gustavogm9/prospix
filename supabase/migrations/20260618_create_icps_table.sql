-- DDL para a tabela de ICPs (Ideal Customer Profile) e relacionamento com campanhas
CREATE TABLE IF NOT EXISTS public.icps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255) NOT NULL,
    min_fit_score INTEGER DEFAULT 3 NOT NULL,
    weights JSONB DEFAULT '{
        "profession_match": 3,
        "whatsapp_valid": 2,
        "is_owner": 2,
        "high_value_area": 1,
        "cnpj_years": 1,
        "google_reputation": 1
    }'::jsonb NOT NULL,
    high_value_areas TEXT[] DEFAULT '{}'::text[] NOT NULL,
    min_google_rating NUMERIC(3,2) DEFAULT 4.0 NOT NULL,
    min_reviews INTEGER DEFAULT 5 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.icps ENABLE ROW LEVEL SECURITY;

-- Remover política antiga se existir e criar a nova
DROP POLICY IF EXISTS icps_tenant_isolation ON public.icps;
CREATE POLICY icps_tenant_isolation ON public.icps
    FOR ALL USING (tenant_id = auth.uid() OR tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

-- Adicionar a coluna icp_id na tabela de campanhas
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS icp_id UUID REFERENCES public.icps(id) ON DELETE RESTRICT;
