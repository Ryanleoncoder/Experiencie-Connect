# Seguranca - Experience Connect

Este documento resume os controles de seguranca aplicados ao projeto em nivel de arquitetura e operacao.

## Principios

1. **Segredos fora do codigo.** Credenciais, tokens e chaves privadas sao fornecidos por variaveis de ambiente.
2. **Servidor como fonte de verdade.** Identidade, progresso, pontuacao e chaves de resposta sao validados no backend.
3. **Menor privilegio.** Chaves de service role ficam restritas a rotas server-side.
4. **Dados minimos.** O modelo guarda apenas o que a experiencia de jogo precisa.

## Camadas de Controle

```text
Browser
  |
  | session token
  v
Vercel API
  |-- CORS
  |-- JWT/session validation
  |-- input limits
  |
  +--> Supabase RLS
  |
  +--> Firebase rules
  |
  +--> VPS API
          |-- shared internal secret
          |-- Redis rate limits
          |-- server-side validation
```

## Autenticacao e Sessao

- Sessoes usam token assinado e validado no servidor.
- Endpoints protegidos derivam o usuario a partir do token.
- Valores enviados pelo navegador, como `userId`, nao substituem a identidade da sessao.
- Limites de evento e acesso a desafios sao aplicados nas APIs.

## Banco de Dados

- Supabase usa Row Level Security para dados de usuario e progresso.
- Funcoes e triggers mantem regras de progressao no servidor.
- Conteudo publico de jogo e lido pelo cliente quando necessario.
- Chaves de resposta e dados administrativos ficam fora do alcance do frontend.

## Rate Limiting e Antiabuso

- Rate limiting combina sinais de sessao, usuario, convite e hash de IP.
- IP puro nao e usado como identificador persistente.
- Logs de seguranca priorizam diagnostico sem expor tokens completos.

## Tratamento de Segredos

- `.gitignore` bloqueia `.env`, `.env.*`, pastas de deploy, caches e backups.
- Arquivos `.env.example` sao mantidos como referencia de configuracao.
- Valores que ja tenham sido expostos devem ser rotacionados antes de qualquer publicacao.
- Secret scanning deve rodar antes de abrir uma versao publica.

```text
.env real --------------> ambiente local / provedor de deploy
.env.example -----------> repositorio
service role keys ------> server-side only
public client config ---> frontend quando protegido por regras do backend
```

## IA e Entradas Livres

- Respostas abertas possuem limite de tamanho.
- Validacoes bloqueiam entradas fora do formato esperado.
- Conteudo enviado para avaliacao deve ser tratado como dado de jogo, nao como fonte confiavel.

## Referencias

- [Politica de Dados](privacy.md)
- [Arquitetura](ARCHITECTURE.md)
- [Banco de Dados](database.md)
