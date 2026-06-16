# Banco de Dados

O banco do Experience Connect guarda identidade do jogador, progresso, tentativas,
temporadas, fases, ranking e trilhas de auditoria. O catalogo de desafios e conteudos fica
separado no Firebase/Firestore.

## Visao Geral

```txt
Frontend
  |
  v
API / Backend
  |
  +--> Supabase PostgreSQL
  |      |-- usuarios
  |      |-- user_progress
  |      |-- challenge_attempts
  |      |-- phase_sessions
  |      |-- intermission_game_sessions
  |      |-- invite_token
  |      +-- security_logs
  |
  +--> Firebase Firestore
         |-- challenges
         +-- achievements
```

## Arquivos

```txt
database/
  migrations/          historico SQL incremental
  migrations/backend/  apoio ao servico administrativo
  supabase/            referencia consolidada do schema
  queries/             consultas de diagnostico
  ops/                 scripts pontuais de manutencao
  firebase/            firebase.json e firestore.rules
```

`migrations/` e a fonte de verdade. A pasta `supabase/` existe para leitura tecnica e
revisao, com arquivos consolidados por tipo de objeto.

## Entidades Principais

| Entidade | Tabelas/RPCs | Funcao |
| --- | --- | --- |
| Jogador | `usuarios` | Registro custom, nickname, avatar, codigo de ranking e flags de conta. |
| Progresso | `user_progress`, `progress_history` | XP, nivel, desafios/minigames concluidos e historico de atualizacoes. |
| Temporada | `seasons`, `state_transitions` | Janela ativa do jogo e historico de mudancas de estado. |
| Tentativas | `challenge_attempts` | Registro idempotente de respostas por desafio, setor e temporada. |
| Fases | `phase_sessions`, `phase_generation` | Ordem persistida de desafios por usuario, nivel e temporada. |
| Intermissao | `intermission_game_sessions` | Sessoes e pontuacao dos minigames entre fases. |
| Convites | `invite_token` | Criacao, expiracao e consumo de convites. |
| Operacao | `security_logs`, `admin_audit_logs`, `platform_config` | Auditoria, configuracao e eventos de seguranca. |

## Fluxo de Progresso

```txt
Resposta do jogador
  |
  v
API valida sessao, rate limit e origem
  |
  v
RPC registra tentativa idempotente
  |
  +--> challenge_attempts
  +--> user_progress
  +--> progress_history
  |
  v
Frontend recebe novo estado do jogador
```

## Fluxo de Fase

```txt
Inicio do nivel
  |
  v
Backend procura phase_sessions active
  |
  +-- existe --> reutiliza ordem persistida
  |
  +-- nao existe --> gera manifest, seed e phase_session_id
                    grava via upsert_phase_session
                    retorna a ordem ao jogador

Reset real de progresso
  |
  +--> cancela phases ativas
  +--> troca phase_generation
```

## RLS e Acesso

O modelo segue uma separacao simples:

| Tipo de dado | Acesso |
| --- | --- |
| Dados publicos de jogo | Leitura controlada quando necessario para a experiencia. |
| Progresso e tentativas | Escrita por RPC/backend, com RLS e grants restritos. |
| Convites | Operacoes mediadas por backend. |
| Admin/auditoria | Service role e endpoints administrativos. |
| Segredos e chaves | Apenas variaveis de ambiente no backend. |

Em Supabase, qualquer tabela exposta pelo Data API deve ter RLS habilitado. Views e funcoes
privilegiadas precisam ser revisadas com o mesmo cuidado, principalmente quando usam
`security definer`.

## Legado

`attempts`, `rate_limits`, `login_attempts` e `distributed_locks` aparecem no historico por
compatibilidade e rastreabilidade. O caminho atual usa `challenge_attempts` para tentativas
de desafio e Redis para controles de janela/tentativa quando configurado.

## Referencias

- [database/README.md](../database/README.md)
- [security.md](security.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
