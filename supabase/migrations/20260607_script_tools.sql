-- Adiciona coluna para armazenar permissões/tools da IA em cada script
ALTER TABLE public.scripts 
ADD COLUMN IF NOT EXISTS ai_tools jsonb DEFAULT '[]'::jsonb;

-- Atualiza a documentação da tabela
COMMENT ON COLUMN public.scripts.ai_tools IS 'Array of strings representing tools the AI is allowed to use (e.g. CALENDAR, PDF, ESCALATE).';
