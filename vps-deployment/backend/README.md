# Backend (VPS)

API em FastAPI para a lógica de jogo sensível a latência do Experience Connect:
composição de fases, minigames e sessões. Usa Redis local como cache e Supabase
e Firebase como fontes de dados. Em produção roda sobre Gunicorn, atrás de Nginx.

## Componentes

```text
app/
├── main.py        aplicacao FastAPI
├── api/           rotas: health, ranking, phase, intermission, internal
├── core/          configuracao, logging e autenticacao de sessao
├── db/            clientes Supabase, Firebase e Redis
└── services/      regras de fases e minigames
```

## Endpoints

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/health` | status dos serviços (Redis, Supabase, Firebase) |
| GET | `/api/ranking/current` | ranking atual |
| GET | `/` | informações básicas da aplicação |

As rotas internas, chamadas pela camada serverless, exigem o segredo interno
compartilhado.

## Execução local

```bash
cd vps-deployment/backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # preencher credenciais
gunicorn app.main:app -c gunicorn.conf.py
```

O serviço sobe em `http://localhost:8000`.
