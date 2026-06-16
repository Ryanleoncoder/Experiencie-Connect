<div align="center">
  <img src="https://polished-paper-d4e4.rysn-craft.workers.dev/" alt="Experience Connect Banner" width="100%">
</div>

# Experience Connect

Experience Connect e uma plataforma educacional para aprendizado gamificado em Customer Experience (CX) e Employee Experience (EX). A experiencia combina desafios, progresso por XP, conquistas colecionaveis, ranking e minigames para transformar conteudo de estudo em uma jornada jogavel.

O projeto foi construido como exercicio pratico de desenvolvimento web full-stack, arquitetura de deploy, persistencia de progresso e design de experiencias digitais.

## Stack

**Frontend**
- HTML5, CSS3 e JavaScript vanilla.
- Componentes e estilos proprios.
- Estado local em `localStorage`/`sessionStorage`, sincronizado com APIs quando necessario.

**Backend serverless**
- Vercel Functions em `api/`.
- Rotas de autenticacao, convite, progresso, validacao e configuracao publica.
- Renderizacao de paginas e injecao de configuracao publica em tempo de requisicao.

**Servicos de suporte**
- Supabase/PostgreSQL para usuarios, progresso, convites, ranking e logs de seguranca.
- Firebase para conteudo de desafios, configuracao e conquistas.
- Redis para cache, rate limiting e sessoes efemeras.
- FastAPI para servicos administrativos e rotinas auxiliares.

## Arquitetura

```text
Jogador
  |
  v
Vercel app + api/*
  |
  +--> Supabase: progresso, convites, ranking
  |
  +--> Firebase: desafios e conquistas
  |
  +--> VPS API: fases, minigames, IA e Redis
  |
  +--> Render: rotinas administrativas
```

## Fluxo da Aplicacao

1. O jogador acessa a plataforma por convite.
2. O onboarding cria a sessao inicial e configura avatar/persona.
3. A aplicacao carrega a jornada de desafios e minigames.
4. O progresso e sincronizado com o backend.
5. XP, niveis, conquistas e ranking refletem a evolucao do jogador.
6. Respostas abertas podem ser avaliadas por um fluxo assistido por IA.

```text
Invite
  |
  v
Login / onboarding
  |
  v
App home
  |
  +--> Challenge
  |      |
  |      +--> validar resposta
  |      +--> sincronizar progresso
  |
  +--> Intermission game
  |
  +--> Ranking / conquistas
```

## Estrutura do Repositorio

```text
api/                      # Endpoints serverless Vercel
frontend/                 # JavaScript client-side, estilos e assets
admin-service/            # Backend administrativo FastAPI
vps-deployment/           # Servicos FastAPI em VPS: backend de jogo e avaliacao por IA
database/                 # Migracoes, consultas SQL e operacoes
invite/                   # Fluxo de convite e onboarding
docs/                     # Documentacao da plataforma
logun-contexts/           # (privado) contextos/gabaritos dos desafios assistidos
*.html                    # Cascas de paginas da aplicacao
vercel.json               # Rotas, rewrites e headers
render.yaml               # Configuracao do admin-service
```

## Rotas Principais

- `/` - Pagina inicial
- `/login` - Autenticacao
- `/invite` - Onboarding por convite
- `/app` - Aplicacao principal
- `/challenge` - Interface de desafio
- `/momento-critico` - Game diario de cartas
- `/duelo-de-experiencia` - Duelo diario de cartas
- `/ranking` - Ranking
- `/conquistas` - Conquistas
- `/resgatar` - Resgate
- `/sobre` - Informacoes do projeto

## Executando Localmente

**Pre-requisitos**
- Node.js 18+
- Python 3.11+ para o `admin-service`
- Projeto Supabase
- Projeto Firebase
- Redis, quando os fluxos que dependem de cache estiverem habilitados

**Frontend e APIs Vercel**

```bash
npm install
cp .env.example .env.local
vercel dev
```

**Admin service**

```bash
cd admin-service
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

## Decisoes Tecnicas

**Separacao de responsabilidades.** O frontend e os endpoints serverless cuidam do fluxo publico da aplicacao. Rotinas administrativas e servicos stateful ficam em backends separados.

**Configuracao por ambiente.** Credenciais, URLs e segredos operacionais sao lidos de variaveis de ambiente. O repositorio contem apenas exemplos sanitizados em arquivos `.env.example`.

**Estado autoritativo no servidor.** Chaves de resposta, composicao de fases e regras de progresso ficam no backend. O cliente recebe apenas os dados necessarios para renderizar a experiencia.

**Progressao gamificada.** XP, niveis, conquistas, ranking e minigames formam um loop de estudo com feedback frequente.

## Limitacoes Conhecidas

- Algumas rotinas de infraestrutura ainda dependem de operacao manual.
- O rollback de migracoes de banco precisa ser planejado por mudanca.
- O rate limiting combina regras de aplicacao e cache; a configuracao final depende do ambiente.
- A invalidacao de sessao depende da expiracao e validacao do token no servidor.

## Deployment

A aplicacao Vercel nao possui etapa de build dedicada: paginas estaticas e funcoes serverless sao publicadas diretamente a partir da raiz do repositorio.

O `render.yaml` configura o `admin-service`. Os servicos executados em VPS - backend de jogo e avaliacao por IA - ficam em `vps-deployment/`, com documentacao e diagrama de arquitetura proprios.

## Documentacao

- [Referencia da Plataforma](./docs/PLATFORM_REFERENCE.md)
- [Arquitetura](./docs/ARCHITECTURE.md)
- [Origem do Projeto](./docs/project-origin.md)
- [Politica de Dados](./docs/privacy.md)
- [Seguranca](./docs/security.md)
- [Security Overview (EN)](./docs/SECURITY-OVERVIEW.md)
- [Banco de Dados](./docs/database.md)
- [Admin Service](./admin-service/README.md)
- [Servicos em VPS](./vps-deployment/README.md)

## Status

Projeto pessoal em evolucao, usado para estudo de produto, engenharia web, banco de dados, seguranca de aplicacoes e design de experiencias gamificadas.
