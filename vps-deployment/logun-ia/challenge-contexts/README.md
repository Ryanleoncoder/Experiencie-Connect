# Challenge contexts

Contextos de avaliação usados pela logun-ia para corrigir respostas abertas:
um arquivo por desafio, mais um contexto padrão de fallback. Cada contexto reúne
os critérios e as referências que o serviço aplica ao gerar a nota e o feedback.

O conteúdo real é mantido fora do repositório público de forma intencional. Na
prática esses arquivos funcionam como gabarito — descrevem o que caracteriza uma
boa resposta e como a pontuação é formada. Publicá-los permitiria ajustar as
respostas ao critério em vez de resolver o desafio.

A estrutura de pastas é versionada (por meio deste README) para documentar a
arquitetura. Os arquivos de contexto existem apenas no ambiente de execução da
VPS. O carregamento e o fallback são tratados em `logun/context_loader.py`.
