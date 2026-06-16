# Referencia da Plataforma - Experience Connect

Este documento resume a estrutura atual do repositorio e as principais superficies de runtime.

## Mapa Rapido

```text
Experience-Connect/
  README.md
  render.yaml
  package.json
  api/                   -> Vercel Functions
  frontend/              -> UI publica
  admin-service/         -> Render / FastAPI
  vps-deployment/        -> VPS services
  database/              -> SQL, rules, queries
  docs/                  -> documentacao publica
```

## 1. Superficies de Runtime

### Aplicacao Web na Vercel

- Raiz do projeto Vercel: raiz do repositorio.
- Configuracao principal: `vercel.json`
- Endpoints serverless: `api/`
- Frontend publico: `frontend/`
- Cascas HTML: arquivos `*.html` na raiz.
- Fluxo de convite: `invite/`

### Backend Administrativo no Render

- Blueprint: `render.yaml`
- Raiz do servico: `admin-service/`
- Framework: FastAPI
- Responsabilidades: rotinas administrativas, ranking, limpeza e suporte operacional.

### Servicos de VPS

- Codigo principal: `vps-deployment/`
- Responsabilidades: sessoes de fase, intermission games, Redis e validacao textual.
- Esses servicos nao fazem parte do deploy Vercel.

```text
Public web app
  |
  +--> Vercel: pages + serverless APIs
  |
  +--> Render: admin jobs and protected operations
  |
  +--> VPS: phase/session engine, Redis and IA support
  |
  +--> Supabase/Firebase: persisted state and content
```

### Banco de Dados

- SQL ativo e migracoes: `database/`
- Regras Firebase: `database/firebase/`
- Service role e credenciais privadas devem ficar apenas em ambiente server-side.

## 2. Rotas Publicas

Rotas principais planejadas:

- `/`
- `/login`
- `/app`
- `/challenge`
- `/intermission-game`
- `/momento-critico`
- `/ranking`
- `/conquistas`
- `/resgatar`
- `/register`
- `/sobre`
- `/outside-window`
- `/maintenance`
- `/season-closed`
- `/invite`

Compatibilidade:

- `/home` e `/home.html` redirecionam para `/app`.
- `home.html` existe como casca de compatibilidade.

Rotas e arquivos internos bloqueados:

- `.env*`
- `.git/*`
- arquivos `.md` e `.txt`
- `preview/`
- paginas de teste e demos
- `ecdesignsystem.html`

## 3. Propriedade das Pastas

### Aplicacao

- `api/`
- `frontend/`
- `invite/`
- arquivos HTML na raiz
- `config/`

### Backends e Servicos

- `admin-service/`
- `vps-deployment/`

### Dados e Documentacao

- `database/`
- `docs/`

### Material Local ou Auxiliar

- `.vercel/`
- `.superpowers/`
- `node_modules/`
- arquivos `.env`
- mocks, screenshots e HTMLs temporarios de redesign

Esses itens podem existir no ambiente local, mas nao devem ser tratados como superficie publica.

## 4. Regras de Deploy

### Vercel

- `.vercelignore` define exclusoes de deploy.
- `vps-deployment/` nao e enviado para a Vercel.
- `database/` e documentacao nao sao necessarias em runtime Vercel.
- Rotas internas e arquivos auxiliares sao bloqueados por `vercel.json`.

### Render

- `render.yaml` aponta para `admin-service/`.
- Variaveis sensiveis usam `sync: false` ou valores gerados pelo provedor.

### Git

- `.gitignore` bloqueia credenciais, caches, dependencias instaladas, backups e artefatos locais.
- Arquivos `.env.example` documentam configuracao esperada sem valores reais.

## 5. Dados Publicos e Privados

O ranking publico deve expor apenas campos de exibicao, como:

- `ranking_code`
- `display_name`
- `xp`
- `level`
- `avatar_file_name`

Nao devem ser expostos por APIs publicas:

- UUIDs internos sem necessidade;
- tokens;
- chaves secretas;
- credenciais de service role;
- detalhes brutos de infraestrutura.

## 6. Onde Comecar

- Rotas publicas: `vercel.json` e `api/render-page.js`
- Frontend: `frontend/js/`
- Estilos: `frontend/styles/`
- Admin service: `admin-service/`
- VPS backend: `vps-deployment/backend/app/`
- Banco: `database/`
