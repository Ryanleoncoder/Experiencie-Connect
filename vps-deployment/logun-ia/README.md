# logun-ia

Logun é o avaliador de respostas abertas do Experience Connect. Na arquitetura
ele não é um modelo único: é um *harness* — uma camada inteligente de
orquestração que recebe o texto do jogador, aplica validação e segurança, e
roteia a avaliação entre vários provedores de IA, escolhendo o melhor a cada
requisição. O retorno é uma nota com feedback estruturado.

Na plataforma, esse mesmo serviço é apresentado aos jogadores como **Logun**,
uma persona de IA. Dar nome e personalidade ao avaliador aproxima a experiência
do público e torna o feedback mais reconhecível do que uma "correção automática"
anônima — a engenharia por trás continua sendo o harness descrito aqui.

O serviço roda em FastAPI sobre Gunicorn, com Redis local para cache e controle.

## Fluxo de avaliação

1. **Pré-validação e segurança.** Limites de tamanho e formato, filtragem de PII
   e detecção de injeção de prompt antes de qualquer chamada a modelo.
2. **Contexto do desafio.** Carrega os critérios e a rubrica do desafio. Esse
   material é mantido fora do repositório (ver `challenge-contexts/` e
   `logun/rubrics/`).
3. **Roteamento por saúde.** Um gateway escolhe o provedor dinamicamente, sem
   ordem fixa. A primeira camada é um motor de regras determinístico, de custo
   zero; quando ela não resolve, o roteador classifica os provedores de LLM por
   latência real, taxa de erro e taxa de sucesso, e usa o melhor disponível.
4. **Avaliação.** O provedor escolhido gera a resposta seguindo o prompt e a
   rubrica do desafio.
5. **Validação de saída e auditoria.** A resposta é validada contra um schema
   antes de ser devolvida, e a decisão é registrada para auditoria.

## Componentes

```text
logun/
├── router.py          gateway de roteamento por saude entre provedores
├── model_selector.py  resolucao da escolha de modelo
├── context_loader.py  carregamento do contexto do desafio
├── providers/         Gemini, Groq, Mistral, NVIDIA, OpenRouter,
│                      modelo local leve e motor de regras
├── validators/        pii_filter, anti_injection, json_schema,
│                      pre_validation, hybrid_validator
├── skills/            classify, evaluate, extract, summarize
├── core/              prompt_builder, rubric_loader, output_validator,
│                      audit_logger
├── config/            configuracao, constantes e selecao de servicos
├── prompts/           (privado) modelos de prompt
├── rubrics/           (privado) rubricas de pontuacao
└── data/              (privado) dados de apoio
```

## Segurança

A avaliação trata o texto do jogador como entrada não confiável. O filtro de PII
e o validador anti-injeção rodam antes de qualquer chamada a modelo, e a saída do
modelo é validada contra um schema antes de ser usada. As decisões ficam
registradas para auditoria.

## Execução local

```bash
cd vps-deployment/logun-ia
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # preencher chaves dos provedores
uvicorn logun.main:app --reload --port 8001
```

Em produção o serviço roda com Gunicorn, usando `gunicorn.conf.py`.
