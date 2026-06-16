# API Middleware

Middlewares compartilhados pelas rotas serverless em `api/`. Eles cuidam de origem,
autenticacao, rate limit, acesso de plataforma e log de eventos de seguranca.

## Pipeline

```txt
Request
  |
  v
cors.js
  |
  v
platform-access.js
  |
  v
jwt-validator.js / redis-rate-limiter.js / redis-login-attempts.js
  |
  v
Handler da rota
  |
  v
security-logger.js
```

Nem toda rota usa todos os middlewares. A ordem recomendada e validar CORS primeiro,
aplicar controles de acesso/rate limit depois e registrar eventos de seguranca sem bloquear
a resposta principal.

## Componentes

| Arquivo | Responsabilidade |
| --- | --- |
| `cors.js` | Valida `Origin`, responde preflight `OPTIONS` e aplica headers CORS. |
| `platform-access.js` | Centraliza regras de acesso relacionadas a janela/estado da plataforma. |
| `jwt-validator.js` | Extrai e valida JWT pelo Supabase Auth antes de operacoes autenticadas. |
| `security-logger.js` | Registra eventos como token invalido, rate limit e falha de login. |
| `redis-rate-limiter.js` | Rate limit por janela usando Redis quando configurado. |
| `redis-login-attempts.js` | Controle de tentativas de login usando Redis quando configurado. |

## Uso Basico

```js
const { validateCORS } = require('./_middleware/cors');
const { requireAuth } = require('./_middleware/jwt-validator');
const { checkRateLimit } = require('./_middleware/redis-rate-limiter');

module.exports = async (req, res) => {
  if (!validateCORS(req, res)) return;

  const auth = await requireAuth(req, res, '/api/example');
  if (!auth.valid) return;

  const limit = await checkRateLimit(`user:${auth.user.id}`, 30, 60);
  if (!limit.allowed) {
    return res.status(429).json({ error: 'Too many requests', retry_after: limit.retryAfter });
  }

  return res.status(200).json({ ok: true });
};
```

## Rate Limit e Tentativas

Os middlewares de Redis acessam um backend interno por variaveis de ambiente:

```txt
CXGAME_VPS_API_BASE=<internal-api-base-url>
INTERNAL_API_SECRET=<shared-secret>
```

Quando Redis ou API interna nao estao configurados, os helpers retornam de forma tolerante
para preservar disponibilidade. Rotas sensiveis ainda devem ter uma protecao alternativa,
como validacao de token, limite por usuario ou fallback de banco.

Padroes de chave usados no codigo:

| Caso | Exemplo |
| --- | --- |
| IP minimizado | `iphash:<hash>` |
| Usuario autenticado | `user:<user_id>` |
| Convite | `invite:<token_hash>` |
| Login | `login:attempts:<nickname>` |

## Logs de Seguranca

`security-logger.js` grava eventos estruturados em `security_logs` sem travar o fluxo da
rota. Quando precisa de sinal de origem, o middleware usa hash de IP em vez de persistir IP
bruto como identificador principal.

Eventos esperados:

| Evento | Quando aparece |
| --- | --- |
| `rate_limit` | Requisicao excede limite de janela. |
| `invalid_token` | JWT ausente, malformado, expirado ou invalido. |
| `login_failed` | Tentativa de login sem sucesso. |
| `invite_blocked` | Convite invalido, expirado ou bloqueado por politica. |

## Boas Praticas

- Validar CORS antes de executar logica da rota.
- Usar `requireAuth` nas rotas que dependem de identidade do jogador.
- Montar chaves de rate limit com identificadores minimizados.
- Nao expor service role keys, segredos internos ou resposta correta ao cliente.
- Registrar falhas de seguranca de forma assincorna e sem interromper a resposta normal.
- Tratar Redis como acelerador/controle compartilhado, nao como unica barreira de seguranca.

## Testes

Os middlewares sao JavaScript comum e podem ser testados com mocks de `req`, `res` e das
dependencias externas. Para smoke test rapido de sintaxe:

```bash
node --check api/_middleware/cors.js
node --check api/_middleware/jwt-validator.js
node --check api/_middleware/security-logger.js
node --check api/_middleware/redis-rate-limiter.js
node --check api/_middleware/redis-login-attempts.js
node --check api/_middleware/platform-access.js
```
