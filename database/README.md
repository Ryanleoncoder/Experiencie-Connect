# Banco de Dados

O Experience Connect usa Supabase/PostgreSQL para estado transacional do jogo e Firebase
Firestore para catalogos de conteudo. Esta pasta concentra o historico SQL, referencias
consolidadas, consultas de apoio e configuracao do Firebase.

## Mapa

```txt
Aplicacao
  |
  | chamadas autenticadas pelo backend/API
  v
Supabase PostgreSQL
  |-- usuarios, progresso, tentativas, convites
  |-- sessoes de fase e minigames
  |-- RPCs de fluxo, ranking e administracao
  |-- RLS, grants e logs de seguranca
  |
  +-- migrations/  historico numerado, fonte de verdade
  +-- supabase/    referencia consolidada para leitura/revisao
  +-- queries/     consultas de diagnostico e acompanhamento
  +-- ops/         scripts pontuais de manutencao

Firebase Firestore
  |
  +-- firebase/    firebase.json e firestore.rules
```

## Organizacao

| Caminho | Papel |
| --- | --- |
| `migrations/` | Historico incremental aplicado ao Supabase. E a referencia principal para evolucao do schema. |
| `migrations/backend/` | SQL de apoio usado pelo servico administrativo e rotas de backend. |
| `supabase/` | Visao consolidada do schema, funcoes, triggers, policies e seed de desenvolvimento. |
| `queries/` | Consultas de diagnostico, dashboard e investigacao. Nao sao migracoes. |
| `ops/` | Operacoes manuais ou correcoes pontuais. Usar com revisao antes de executar. |
| `firebase/` | Configuracao do Firebase CLI e regras de leitura do Firestore. |

## Historico de migracoes

| Faixa | Conteudo principal |
| --- | --- |
| `00-03` | Tabelas base, usuarios, progresso e primeiras RPCs. |
| `06-15` | Convites, autenticacao custom, rate limit inicial e logs de seguranca. |
| `16-24` | Consolidacao de RLS, idempotencia e limpeza de funcoes antigas. |
| `26-33` | XP por nivel, minigames de intermissao, ranking, fluxo do usuario e hardening. |
| `34-38` | Normalizacao de desafios, controle de fases, reativacao de sessoes e seed de geracao. |
| `backend/` | Views, tabelas e RPCs usados pelo servico administrativo. |

## Tabelas e fluxos

| Area | Objetos principais |
| --- | --- |
| Jogadores | `usuarios`, `user_progress`, `progress_history` |
| Temporadas | `seasons`, `state_transitions` |
| Desafios | `challenge_attempts`, `attempts` (legado), RPCs de validacao e progresso |
| Fases | `phase_sessions`, `phase_generation`, RPCs de upsert/complete/reset |
| Intermissao | `intermission_game_sessions` |
| Convites | `invite_token` |
| Operacao | `security_logs`, `admin_audit_logs`, `platform_config` |
| Infra legado | `rate_limits`, `login_attempts`, `distributed_locks` |

`rate_limits`, `login_attempts` e `distributed_locks` permanecem como historico de uma
implementacao anterior baseada em banco. O fluxo atual usa Redis para controles de janela,
tentativas e locks quando configurado.

## Referencia consolidada

Os arquivos em `supabase/` ajudam a revisar o modelo sem percorrer todo o historico:

| Arquivo | Conteudo |
| --- | --- |
| `01_tables.sql` | Snapshot das tabelas principais. |
| `02_functions.sql` | Manifesto das funcoes/RPCs. |
| `03_triggers.sql` | Manifesto dos triggers. |
| `04_policies.sql` | Referencia de policies/RLS. |
| `05_seed_dev.sql` | Seed minimo para ambiente local. |

Quando uma migracao nova entra, o historico numerado continua sendo a fonte de verdade.
A referencia consolidada deve ser atualizada depois que o schema for validado.

## Seguranca

- Credenciais e service role keys ficam fora do repositorio e entram por variaveis de ambiente.
- Tabelas acessiveis pelo Data API devem manter RLS habilitado.
- Operacoes privilegiadas usam backend ou service role, nunca cliente publico.
- Logs de seguranca usam sinais minimizados, como hash de IP, em vez de depender de IP bruto.
- Chaves de resposta e dados sensiveis de validacao nao ficam disponiveis para o frontend.

Veja tambem [docs/database.md](../docs/database.md), [docs/security.md](../docs/security.md) e
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).
