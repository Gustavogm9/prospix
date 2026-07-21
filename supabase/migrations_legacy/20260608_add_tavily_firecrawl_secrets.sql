-- Adiciona chaves de API do Tavily e Firecrawl
ALTER TABLE tenant_secrets 
ADD COLUMN IF NOT EXISTS tavily_api_key_encrypted text,
ADD COLUMN IF NOT EXISTS firecrawl_api_key_encrypted text;
