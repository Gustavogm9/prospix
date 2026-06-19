-- Migration to create meeting_settings table for tenant schedule availability
CREATE TABLE IF NOT EXISTS public.meeting_settings (
    tenant_id uuid NOT NULL PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
    available_days integer[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5],
    start_hour text NOT NULL DEFAULT '09:00',
    end_hour text NOT NULL DEFAULT '18:00',
    lunch_start text NOT NULL DEFAULT '12:00',
    lunch_end text NOT NULL DEFAULT '13:30',
    default_duration integer NOT NULL DEFAULT 30,
    buffer_minutes integer NOT NULL DEFAULT 15,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.meeting_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view meeting settings of their tenant" ON public.meeting_settings;
CREATE POLICY "Users can view meeting settings of their tenant" 
    ON public.meeting_settings FOR SELECT 
    USING (tenant_id = auth.tenant_id());

DROP POLICY IF EXISTS "Users can update meeting settings of their tenant" ON public.meeting_settings;
CREATE POLICY "Users can update meeting settings of their tenant" 
    ON public.meeting_settings FOR UPDATE 
    USING (tenant_id = auth.tenant_id());

DROP POLICY IF EXISTS "Users can insert meeting settings of their tenant" ON public.meeting_settings;
CREATE POLICY "Users can insert meeting settings of their tenant" 
    ON public.meeting_settings FOR INSERT 
    WITH CHECK (tenant_id = auth.tenant_id());
