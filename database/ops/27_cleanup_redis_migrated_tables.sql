-- Propósito: Remover tabelas migradas para o Redis VPS por melhor desempenho

-- Utilizada por: APIs Vercel (middleware de rate limiting)

DROP TABLE IF EXISTS public.rate_limits CASCADE;

COMMENT ON SCHEMA public IS
'Tabela rate_limits removida — migrada para Redis VPS para controle de taxa';

-- Utilizada por: APIs Vercel (rastreamento de tentativas de login)

DROP TABLE IF EXISTS public.login_attempts CASCADE;

COMMENT ON SCHEMA public IS
'Tabela login_attempts removida — migrada para Redis VPS para rastreamento de login';

-- Utilizada por: Backend (locks distribuídos)

DROP TABLE IF EXISTS public.distributed_locks CASCADE;

COMMENT ON SCHEMA public IS
'Tabela distributed_locks removida — migrada para Redis VPS para locking';

-- As funções associadas às tabelas removidas podem ser excluídas para limpeza adicional:


