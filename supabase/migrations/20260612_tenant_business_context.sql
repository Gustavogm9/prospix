-- Migration: tenant_business_context
-- Creates a table to store AI persona, tone, objections, and standard approaches for each tenant.

CREATE TABLE IF NOT EXISTS public.tenant_business_context (
    tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
    persona_name TEXT,
    persona_role TEXT,
    business_description TEXT,
    common_objections TEXT,
    standard_approaches TEXT,
    tone_of_voice TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS
ALTER TABLE public.tenant_business_context ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their tenant's business context"
    ON public.tenant_business_context FOR SELECT
    USING (tenant_id IN (
        SELECT tenant_id FROM public.users WHERE id = auth.uid()
    ));

CREATE POLICY "Users can update their tenant's business context"
    ON public.tenant_business_context FOR UPDATE
    USING (tenant_id IN (
        SELECT tenant_id FROM public.users WHERE id = auth.uid()
    ));

CREATE POLICY "Users can insert their tenant's business context"
    ON public.tenant_business_context FOR INSERT
    WITH CHECK (tenant_id IN (
        SELECT tenant_id FROM public.users WHERE id = auth.uid()
    ));

-- Add trigger for updated_at
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.tenant_business_context
  FOR EACH ROW EXECUTE PROCEDURE moddatetime (updated_at);
