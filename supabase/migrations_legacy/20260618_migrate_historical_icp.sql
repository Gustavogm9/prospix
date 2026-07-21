-- Migração PL/pgSQL para converter filtros JSON de campanhas para registros na tabela icps
DO $$
DECLARE
    r RECORD;
    new_icp_id UUID;
    v_filters JSONB;
BEGIN
    FOR r IN SELECT id, tenant_id, name, filters FROM public.campaigns LOOP
        -- Verificar se a campanha já tem icp_id atribuído para evitar duplicidade em execuções repetidas
        IF NOT EXISTS (SELECT 1 FROM public.campaigns WHERE id = r.id AND icp_id IS NOT NULL) THEN
            v_filters := COALESCE(r.filters, '{}'::jsonb);
            
            INSERT INTO public.icps (tenant_id, name, min_fit_score, weights, high_value_areas, min_google_rating, min_reviews)
            VALUES (
                r.tenant_id,
                'ICP - ' || r.name,
                COALESCE((v_filters->>'min_fit_score')::int, 3),
                COALESCE(v_filters->'weights', '{
                    "profession_match": 3,
                    "whatsapp_valid": 2,
                    "is_owner": 2,
                    "high_value_area": 1,
                    "cnpj_years": 1,
                    "google_reputation": 1
                }'::jsonb),
                COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_filters->'high_value_areas')), '{}'::text[]),
                COALESCE((v_filters->>'min_google_rating')::numeric, 4.0),
                COALESCE((v_filters->>'min_reviews')::int, 5)
            )
            RETURNING id INTO new_icp_id;

            -- Atualizar campanha vinculando o icp_id
            UPDATE public.campaigns SET icp_id = new_icp_id WHERE id = r.id;
        END IF;
    END LOOP;
END $$;
