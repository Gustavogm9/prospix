BEGIN;

CREATE TABLE IF NOT EXISTS public.commercial_knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  script_id UUID NULL REFERENCES public.scripts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'SKILL'
    CHECK (kind IN ('SKILL', 'PRODUCT_FACT', 'OBJECTION', 'RESTRICTION')),
  skill_key TEXT NOT NULL
    CHECK (skill_key IN (
      'opening', 'discovery', 'implication', 'qualification', 'objection',
      'value', 'commitment', 'disqualification', 'handoff'
    )),
  stage TEXT NULL CHECK (stage IS NULL OR char_length(stage) BETWEEN 1 AND 80),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  content TEXT NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 4000),
  trigger_intents TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  keywords TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  source_url TEXT NULL CHECK (source_url IS NULL OR char_length(source_url) <= 1000),
  priority SMALLINT NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'APPROVED', 'ARCHIVED')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by UUID NULL REFERENCES public.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  updated_by UUID NULL REFERENCES public.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  search_vector TSVECTOR NOT NULL DEFAULT ''::TSVECTOR
);

COMMENT ON TABLE public.commercial_knowledge_chunks IS
  'Tenant and script scoped, versioned commercial knowledge used by the WhatsApp response RAG.';
COMMENT ON COLUMN public.commercial_knowledge_chunks.kind IS
  'SKILL guides behavior; only PRODUCT_FACT can support product or operational claims.';
COMMENT ON COLUMN public.commercial_knowledge_chunks.source_url IS
  'Administrative provenance only. Runtime must never fetch this URL.';

CREATE INDEX IF NOT EXISTS commercial_knowledge_scope_idx
  ON public.commercial_knowledge_chunks (
    tenant_id,
    script_id,
    status,
    active,
    skill_key,
    priority DESC
  );
CREATE INDEX IF NOT EXISTS commercial_knowledge_search_idx
  ON public.commercial_knowledge_chunks USING GIN (search_vector);

CREATE OR REPLACE FUNCTION public.refresh_commercial_knowledge_search_vector()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.search_vector := pg_catalog.to_tsvector(
    'portuguese'::REGCONFIG,
    coalesce(NEW.title, '') || ' ' || coalesce(NEW.content, '') || ' ' ||
    coalesce(pg_catalog.array_to_string(NEW.keywords, ' '), '') || ' ' ||
    coalesce(pg_catalog.array_to_string(NEW.trigger_intents, ' '), '')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS commercial_knowledge_search_vector
  ON public.commercial_knowledge_chunks;
CREATE TRIGGER commercial_knowledge_search_vector
  BEFORE INSERT OR UPDATE OF title, content, keywords, trigger_intents
  ON public.commercial_knowledge_chunks
  FOR EACH ROW EXECUTE FUNCTION public.refresh_commercial_knowledge_search_vector();

CREATE OR REPLACE FUNCTION public.validate_commercial_knowledge_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.script_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.scripts AS scripts
    WHERE scripts.id = NEW.script_id
      AND scripts.tenant_id = NEW.tenant_id
      AND scripts.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'commercial knowledge script scope mismatch'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS commercial_knowledge_scope_guard
  ON public.commercial_knowledge_chunks;
CREATE TRIGGER commercial_knowledge_scope_guard
  BEFORE INSERT OR UPDATE OF tenant_id, script_id
  ON public.commercial_knowledge_chunks
  FOR EACH ROW EXECUTE FUNCTION public.validate_commercial_knowledge_scope();

CREATE OR REPLACE FUNCTION public.touch_commercial_knowledge_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  IF NEW.content IS DISTINCT FROM OLD.content
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.skill_key IS DISTINCT FROM OLD.skill_key
    OR NEW.keywords IS DISTINCT FROM OLD.keywords
    OR NEW.trigger_intents IS DISTINCT FROM OLD.trigger_intents
  THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS commercial_knowledge_updated_at
  ON public.commercial_knowledge_chunks;
CREATE TRIGGER commercial_knowledge_updated_at
  BEFORE UPDATE ON public.commercial_knowledge_chunks
  FOR EACH ROW EXECUTE FUNCTION public.touch_commercial_knowledge_updated_at();

ALTER TABLE public.commercial_knowledge_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commercial_knowledge_select
  ON public.commercial_knowledge_chunks;
CREATE POLICY commercial_knowledge_select
  ON public.commercial_knowledge_chunks
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    OR (SELECT public.current_user_role()) = 'GUILDS_ADMIN'
  );

DROP POLICY IF EXISTS commercial_knowledge_insert
  ON public.commercial_knowledge_chunks;
CREATE POLICY commercial_knowledge_insert
  ON public.commercial_knowledge_chunks
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      tenant_id = (SELECT public.current_tenant_id())
      AND (SELECT public.current_user_role()) = 'OWNER'
    )
    OR (SELECT public.current_user_role()) = 'GUILDS_ADMIN'
  );

DROP POLICY IF EXISTS commercial_knowledge_update
  ON public.commercial_knowledge_chunks;
CREATE POLICY commercial_knowledge_update
  ON public.commercial_knowledge_chunks
  FOR UPDATE TO authenticated
  USING (
    (
      tenant_id = (SELECT public.current_tenant_id())
      AND (SELECT public.current_user_role()) = 'OWNER'
    )
    OR (SELECT public.current_user_role()) = 'GUILDS_ADMIN'
  )
  WITH CHECK (
    (
      tenant_id = (SELECT public.current_tenant_id())
      AND (SELECT public.current_user_role()) = 'OWNER'
    )
    OR (SELECT public.current_user_role()) = 'GUILDS_ADMIN'
  );

DROP POLICY IF EXISTS commercial_knowledge_delete
  ON public.commercial_knowledge_chunks;
CREATE POLICY commercial_knowledge_delete
  ON public.commercial_knowledge_chunks
  FOR DELETE TO authenticated
  USING (
    (
      tenant_id = (SELECT public.current_tenant_id())
      AND (SELECT public.current_user_role()) = 'OWNER'
    )
    OR (SELECT public.current_user_role()) = 'GUILDS_ADMIN'
  );

REVOKE ALL ON public.commercial_knowledge_chunks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.commercial_knowledge_chunks TO authenticated;
GRANT ALL ON public.commercial_knowledge_chunks TO service_role;

CREATE OR REPLACE FUNCTION public.retrieve_commercial_knowledge(
  p_tenant_id UUID,
  p_script_id UUID,
  p_query TEXT,
  p_intent TEXT,
  p_stage TEXT,
  p_skill_key TEXT,
  p_limit INTEGER
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  content TEXT,
  kind TEXT,
  skill_key TEXT,
  stage TEXT,
  trigger_intents TEXT[],
  keywords TEXT[],
  priority SMALLINT,
  version INTEGER,
  rank DOUBLE PRECISION
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_query TSQUERY;
  v_limit INTEGER := LEAST(3, GREATEST(1, coalesce(p_limit, 3)));
  v_jwt_role TEXT := coalesce(auth.role(), 'anon');
  v_user_role TEXT := coalesce(public.current_user_role(), 'anon');
  v_current_tenant UUID := public.current_tenant_id();
BEGIN
  IF v_jwt_role <> 'service_role'
    AND v_user_role <> 'GUILDS_ADMIN'
    AND v_current_tenant IS DISTINCT FROM p_tenant_id
  THEN
    RAISE EXCEPTION 'commercial knowledge tenant access denied'
      USING ERRCODE = '42501';
  END IF;

  IF p_script_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.scripts AS scripts
    WHERE scripts.id = p_script_id
      AND scripts.tenant_id = p_tenant_id
      AND scripts.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'commercial knowledge script access denied'
      USING ERRCODE = '42501';
  END IF;

  v_query := pg_catalog.websearch_to_tsquery(
    'portuguese'::REGCONFIG,
    left(coalesce(p_query, ''), 600)
  );

  RETURN QUERY
  SELECT
    chunks.id,
    chunks.title,
    chunks.content,
    chunks.kind,
    chunks.skill_key,
    chunks.stage,
    chunks.trigger_intents,
    chunks.keywords,
    chunks.priority,
    chunks.version,
    (
      CASE
        WHEN pg_catalog.numnode(v_query) = 0 THEN 0
        ELSE pg_catalog.ts_rank_cd(chunks.search_vector, v_query)::DOUBLE PRECISION * 100
      END
      + CASE WHEN chunks.skill_key = p_skill_key THEN 8 ELSE 0 END
      + CASE WHEN upper(coalesce(p_intent, '')) = ANY(chunks.trigger_intents) THEN 5 ELSE 0 END
      + CASE WHEN lower(coalesce(chunks.stage, '')) = lower(coalesce(p_stage, '')) THEN 2 ELSE 0 END
      + chunks.priority::DOUBLE PRECISION / 100
    ) AS relevance
  FROM public.commercial_knowledge_chunks AS chunks
  WHERE chunks.tenant_id = p_tenant_id
    AND (chunks.script_id IS NULL OR chunks.script_id = p_script_id)
    AND chunks.status = 'APPROVED'
    AND chunks.active = TRUE
    AND (
      pg_catalog.numnode(v_query) = 0
      OR chunks.search_vector @@ v_query
      OR chunks.skill_key = p_skill_key
      OR upper(coalesce(p_intent, '')) = ANY(chunks.trigger_intents)
      OR lower(coalesce(chunks.stage, '')) = lower(coalesce(p_stage, ''))
    )
  ORDER BY relevance DESC, chunks.priority DESC, chunks.updated_at DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.retrieve_commercial_knowledge(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retrieve_commercial_knowledge(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER
) TO authenticated, service_role;

COMMIT;
