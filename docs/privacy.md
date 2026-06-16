# Politica de Dados - Experience Connect

Experience Connect armazena apenas os dados necessarios para a experiencia de jogo funcionar: progresso, ranking, conquistas e preferencias visuais do jogador.

## Principio

A plataforma usa minimizacao de dados. Sempre que uma informacao nao e necessaria para o fluxo de jogo, ela nao deve fazer parte do modelo.

## Mapa de Dados

```text
Jogador
  |
  | nickname, avatar, respostas de jogo
  v
APIs da aplicacao
  |
  +--> Supabase: usuario, progresso, ranking, convites
  |
  +--> Firebase: conteudo e conquistas
  |
  +--> Redis: estado temporario e rate limiting
```

## Dados Armazenados

| Dado | Finalidade |
| --- | --- |
| Nome de exibicao | Identificar o jogador no ranking e na interface. |
| Avatar | Personalizar a experiencia visual. |
| XP | Medir progresso acumulado. |
| Nivel | Representar a etapa atual da jornada. |
| Conquistas | Registrar marcos desbloqueados. |
| Progresso | Continuar desafios e minigames de onde o jogador parou. |
| Convite | Controlar entrada e onboarding. |

## Dados Fora do Modelo

A aplicacao nao precisa de dados sensiveis para funcionar. Campos livres, como nome de exibicao, devem ser usados com apelidos ou nomes escolhidos pelo proprio jogador.

```text
Dados de jogo                 Fora do modelo
-------------                 --------------
display_name                  CPF
avatar                        documento
XP / level                    telefone
conquistas                    endereco
progresso                     dados financeiros
convite                       senha em texto puro
```

Exemplos de dados que nao pertencem ao fluxo:

- CPF;
- documento de identidade;
- endereco;
- telefone;
- dados financeiros;
- senhas em texto puro.

## Conteudo Enviado pelo Jogador

Respostas abertas podem ser processadas por APIs de validacao. Esses textos devem ser tratados como conteudo de jogo e passam por validacoes de tamanho, formato e seguranca antes de serem aceitos.

## Seguranca dos Dados

- Credenciais ficam em variaveis de ambiente.
- Arquivos `.env.example` documentam nomes de variaveis sem valores reais.
- APIs protegidas validam sessao no servidor.
- Regras de banco e RLS limitam acesso direto aos dados.
- Logs de seguranca evitam registrar tokens completos ou IP bruto.

## Referencias

- [Origem do Projeto](project-origin.md)
- [Seguranca](security.md)
- [Banco de Dados](database.md)
