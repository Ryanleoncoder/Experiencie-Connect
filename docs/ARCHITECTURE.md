# Arquitetura - Experience Connect

Experience Connect e uma plataforma de estudo gamificada. A aplicacao combina paginas web, APIs serverless, banco relacional, conteudo em Firebase, cache Redis e servicos auxiliares para fases e validacao assistida por IA.

## Visao Geral

```text
                       +----------------------+
                       |       Browser        |
                       |  HTML / CSS / JS UI  |
                       +----------+-----------+
                                  |
                                  | HTTPS
                                  v
             +--------------------+--------------------+
             |                 Vercel                  |
             |  static pages + serverless API routes   |
             |  *.html + api/*                         |
             +---------+----------------------+---------+
                       |                      |
                       |                      |
                       v                      v
        +--------------+-------------+   +----+----------------+
        | Supabase / PostgreSQL      |   | Firebase           |
        | users, progress, ranking   |   | content, config,   |
        | RLS and server functions   |   | achievements       |
        +--------------+-------------+   +----+----------------+
                       ^
                       |
                       |
             +---------+----------------------+
             |          Render Admin          |
             |  FastAPI jobs and operations   |
             |  admin-service/                |
             +--------------------------------+

                                  |
                                  | authenticated API calls
                                  v
             +--------------------+--------------------+
             |                 VPS API                 |
             |  phase sessions, intermission games,    |
             |  text validation and short-lived cache   |
             +--------------------+--------------------+
                                  |
                                  v
                         +--------+--------+
                         |      Redis      |
                         | ephemeral state |
                         +-----------------+
```

## Componentes

### Frontend e APIs Vercel

- Paginas HTML renderizadas a partir das cascas em `*.html`.
- JavaScript e estilos em `frontend/`.
- Funcoes serverless em `api/`.
- `vercel.json` define rewrites, headers e bloqueios de rotas internas.

### Admin Service

- Backend FastAPI em `admin-service/`.
- Configurado pelo `render.yaml` da raiz do repositorio.
- Responsavel por rotinas administrativas, ranking e endpoints protegidos.

### VPS Deployment

- Codigo em `vps-deployment/`.
- Servicos auxiliares para sessoes de fase, intermission games, cache e avaliacao textual.
- Redis usado para estado efemero, rate limiting e cache curto.

### Bancos e Conteudo

- **Supabase/PostgreSQL:** usuarios, progresso, convites, ranking, logs de seguranca e regras relacionais.
- **Firebase:** conteudo de desafios, configuracoes e conquistas.
- **Redis:** sessoes temporarias, limites de uso e caches.

## Fluxo de Jogo

1. O browser carrega a aplicacao pela Vercel.
2. A sessao do jogador e validada por APIs serverless.
3. A aplicacao solicita a fase atual.
4. O backend monta ou recupera a ordem de desafios e minigames.
5. O jogador responde desafios e recebe feedback.
6. O progresso e sincronizado com Supabase.
7. Rankings e conquistas sao atualizados a partir do estado persistido.

## Decisoes de Arquitetura

**Server-authoritative.** Regras criticas, chaves de resposta e validacoes ficam no servidor.

**Frontend leve.** O cliente renderiza a experiencia e mantem estado local temporario, mas nao decide progresso autoritativo sozinho.

**Servicos separados por responsabilidade.** Vercel atende paginas e APIs publicas; Render executa administracao; VPS concentra componentes stateful.

**Configuracao por ambiente.** O mesmo codigo pode rodar em ambientes diferentes sem embutir credenciais ou hosts sensiveis.

**Falha controlada.** Quando caches ou servicos auxiliares falham, os fluxos devem degradar com mensagens claras ou fallback seguro.

## Stack

- Frontend: HTML, CSS e JavaScript vanilla.
- Serverless: Node.js em Vercel Functions.
- Backend: FastAPI/Python.
- Dados: Supabase/PostgreSQL, Firebase e Redis.
- Testes: Jest para JavaScript; Pytest para servicos Python.
