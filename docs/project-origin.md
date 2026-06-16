# Origem do Projeto - Experience Connect

Experience Connect nasceu como um projeto pessoal de estudo em desenvolvimento web, gamificacao e design de experiencia digital.

A ideia inicial era simples: transformar conteudo de aprendizado em uma jornada jogavel, com desafios, progresso visivel, feedback frequente e pequenas pausas interativas. Os temas de CX e EX entraram como contexto educacional porque combinam bem com cenarios de decisao, empatia, comunicacao e melhoria continua.

## Motivacao

O projeto explora uma pergunta pratica:

> Como uma experiencia de treinamento pode parecer menos com uma lista de tarefas e mais com um jogo?

A partir disso, a plataforma evoluiu para uma aplicacao completa, com frontend, APIs, persistencia de progresso, ranking, conquistas, minigames e validacao assistida por IA.

## Loop de Experiencia

```text
Convite
   |
   v
Onboarding -----> Avatar / Persona
   |
   v
Desafios -----> Feedback -----> XP
   ^              |              |
   |              v              v
   |          Minigames      Conquistas
   |              |              |
   +--------------+---- Ranking -+
```

## Objetivos

- Praticar arquitetura web de ponta a ponta.
- Construir um fluxo gamificado com XP, niveis, ranking e conquistas.
- Experimentar feedback assistido por IA em respostas abertas.
- Criar uma identidade visual propria para a plataforma.
- Manter configuracao e credenciais fora do codigo-fonte.

## Aprendizados

- Progressao precisa ser clara para o jogador.
- Feedback frequente torna o estudo mais envolvente.
- Um design system simples e consistente vale mais que excesso de efeitos.
- Separar frontend, APIs, banco e servicos auxiliares facilita evoluir o projeto.
- Configuracao por ambiente deixa o repositorio mais simples de revisar e reutilizar.

## Evolucao da Arquitetura

A aplicacao esta organizada em quatro camadas principais:

```text
Frontend + APIs Vercel
        |
        v
Backends de suporte
        |
        +--> Admin service
        +--> VPS services
        |
        v
Dados e conteudo
        |
        +--> Supabase
        +--> Firebase
        +--> Redis
```

O mapa atual da estrutura esta documentado em [Referencia da Plataforma](PLATFORM_REFERENCE.md).
