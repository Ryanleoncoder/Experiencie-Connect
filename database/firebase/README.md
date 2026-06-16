# Firebase

Esta pasta guarda os arquivos de banco relacionados ao Firebase/Firestore.

## Conteudo

| Arquivo | Uso |
| --- | --- |
| `firebase.json` | Configuracao do Firebase CLI para deploy das regras. |
| `firestore.rules` | Regras de acesso do Firestore. |

## Papel no Projeto

```txt
Admin/Backend
  |
  v
Firebase Firestore
  |
  +-- challenges
  +-- achievements
  +-- outros catalogos de conteudo

Supabase PostgreSQL
  |
  +-- usuarios
  +-- progresso
  +-- convites
  +-- ranking
```

O Firebase fica ao lado do material de banco porque define regras de acesso a dados,
mesmo nao sendo parte do schema PostgreSQL.

## Notas

- O codigo de runtime nao carrega `firebase.json` nem `firestore.rules` diretamente.
- Credenciais Firebase nao devem ser commitadas. Use variaveis de ambiente ou arquivo local
  ignorado pelo Git.
- A documentacao geral do modelo de dados fica em [docs/database.md](../../docs/database.md).
