# Admin Service

Servico administrativo em FastAPI para operacoes de suporte do Experience Connect:
temporadas, usuarios, ranking, relatorios, jobs agendados e manutencao de conteudo.

## Papel no Projeto

```txt
Frontend
  |
  v
APIs serverless
  |
  +--> Supabase
  +--> Firebase
  +--> Redis

Admin Service
  |
  +--> endpoints admin
  +--> endpoints cron
  +--> relatorios
  +--> CLI de operacao
```

As rotas voltadas ao jogador ficam nas APIs serverless. O Admin Service concentra tarefas
menos sensiveis a latencia e operacoes que exigem credenciais administrativas.

## Stack

| Area | Tecnologia |
| --- | --- |
| API | FastAPI, Uvicorn/Gunicorn |
| Runtime | Python 3.11+ |
| Banco | Supabase Python SDK |
| Conteudo | Firebase Admin SDK |
| Cache/controles | Redis opcional |
| CLI | Click, Rich |
| Testes | Pytest |

## Estrutura

```txt
admin-service/
  app/
    api/          rotas FastAPI
    core/         configuracao e logging
    db/           clientes Supabase, Firebase e Redis
    middleware/   admin secret, cron secret, CORS e rate limit
    models/       schemas Pydantic
    services/     regras de negocio
    main.py       aplicacao FastAPI
  tests/          testes unitarios e de integracao
  cli.py          comandos administrativos
```

## Configuracao Local

```bash
cd admin-service
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

No Linux/macOS, ative o ambiente com `source venv/bin/activate`.

Variaveis importantes:

```txt
SUPABASE_URL=<supabase-url>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
FIREBASE_PROJECT_ID=<firebase-project-id>
FIREBASE_CREDENTIALS_BASE64=<service-account-json-base64>
ADMIN_SECRET=<admin-shared-secret>
CRON_SECRET=<cron-shared-secret>
REDIS_URL=<redis-url>
```

Execute localmente:

```bash
uvicorn app.main:app --reload --port 8000
```

Documentacao interativa local:

```txt
http://localhost:8000/docs
http://localhost:8000/redoc
```

## Rotas

| Grupo | Prefixo | Exemplos |
| --- | --- | --- |
| Health | `/health` | `/health`, `/health/detailed`, `/health/stats` |
| Admin | `/admin` | usuarios, ban/unban, reset de progresso, temporadas, desafios, audit logs |
| Cron | `/internal/cron` | ranking diario, fechamento de temporada, limpeza de dados |
| Ranking | `/ranking` | ranking atual e historico |
| Reports | `/reports` | retencao, atividade diaria, XP e dificuldade de desafios |

Rotas admin exigem `X-Admin-Secret`. Rotas cron exigem `X-Cron-Secret`.

## CLI

```bash
python -m app.cli view-status
python -m app.cli generate-ranking
python -m app.cli close-season --confirm
python -m app.cli upload-challenges --file challenges.csv --confirm
python -m app.cli list-users --filter banned
```

## Seguranca

- Secrets administrativos ficam em variaveis de ambiente.
- Service role do Supabase e credenciais Firebase sao usados apenas no backend.
- Middlewares separam acesso admin, cron, CORS e rate limit.
- Operacoes sensiveis devem registrar auditoria em `admin_audit_logs` quando aplicavel.
- Dados de jogador retornados por endpoints admin devem ser filtrados conforme a necessidade da operacao.

## Testes

```bash
pytest
pytest --cov=app --cov-report=html
pytest tests/test_admin_secret_middleware.py
pytest tests/test_cron_secret_middleware.py
pytest tests/test_rate_limit.py
```

## Deployment

O servico pode rodar como web service Python com o comando:

```bash
gunicorn app.main:app --workers 2 --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT
```

O arquivo `render.yaml` da raiz descreve a configuracao usada para deploy.
