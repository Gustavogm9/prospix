-- Migration: Create CNPJ cache tables (shared across all tenants)
-- This cache eliminates duplicate API calls when multiple tenants
-- search for the same companies.

CREATE TABLE IF NOT EXISTS cnpj_cache (
  cnpj          TEXT PRIMARY KEY,          -- CNPJ limpo (14 dígitos)
  razao_social  TEXT,
  nome_fantasia TEXT,
  situacao      TEXT,                      -- ATIVA / INATIVA
  data_abertura DATE,
  cnae          TEXT,
  uf            TEXT,
  municipio     TEXT,
  bairro        TEXT,
  qsa           JSONB DEFAULT '[]',       -- Lista de sócios
  raw_data      JSONB,                    -- Resposta completa da API
  source        TEXT DEFAULT 'cnpja',     -- Fonte: cnpja_open, cnpja_commercial, brasilapi, receitaws
  fetched_at    TIMESTAMPTZ DEFAULT now(),
  expires_at    TIMESTAMPTZ DEFAULT (now() + interval '30 days')
);

-- Full-text search index for fuzzy name matching
CREATE INDEX IF NOT EXISTS idx_cnpj_cache_nome 
  ON cnpj_cache USING gin(to_tsvector('portuguese', razao_social || ' ' || COALESCE(nome_fantasia, '')));

-- Index for city+state filtering
CREATE INDEX IF NOT EXISTS idx_cnpj_cache_municipio 
  ON cnpj_cache(municipio, uf);

-- Name-to-CNPJ mapping table (caches search results)
CREATE TABLE IF NOT EXISTS cnpj_name_search_cache (
  id            SERIAL PRIMARY KEY,
  search_query  TEXT NOT NULL,            -- Normalized company name used in search
  search_city   TEXT,                     -- City filter used
  search_uf     TEXT,                     -- State filter used
  cnpj          TEXT REFERENCES cnpj_cache(cnpj),
  relevance     REAL DEFAULT 0,           -- Match relevance score
  searched_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(search_query, search_city, cnpj)
);

-- Full-text search index for cached name searches
CREATE INDEX IF NOT EXISTS idx_cnpj_name_search 
  ON cnpj_name_search_cache USING gin(to_tsvector('portuguese', search_query));
