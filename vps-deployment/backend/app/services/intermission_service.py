"""
Intermission game orchestration.

The VPS owns the level manifest and completion scoring so the frontend does
not decide when a game appears or how much XP a game awards.
"""

from __future__ import annotations

import base64
import copy
import hashlib
import hmac
import json
import math
import random
import re
from typing import Any, Dict, List, Optional


VISUAL_GAME_IDS = [
    "termo-cx",
    "conexo-cx",
    "quem-disse-cx",
    "sequencia-cx",
    "termo-ex",
    "conexo-ex",
    "quem-disse-ex",
    "sequencia-ex",
]

ACTIVE_GAME_IDS = [
    "termo-cx",
    "conexo-cx",
    "quem-disse-cx",
    "sequencia-cx",
]

# Games ativos por setor: CX = Customer Experience, EX = Employee Experience.
# Coral e identidade do intermission nos dois (o setor diferencia por rotulo, nao por cor).
ACTIVE_GAMES_BY_SETOR = {
    "CX": ["termo-cx", "conexo-cx", "quem-disse-cx", "sequencia-cx"],
    "EX": ["termo-ex", "conexo-ex", "quem-disse-ex", "sequencia-ex"],
}

GAME_ALIASES = {
    "quem-disse": "quem-disse-cx",
}


GAME_CATALOG: Dict[str, Dict[str, Any]] = {
    "termo-cx": {
        "id": "termo-cx",
        "title": "Termo CX",
        "subtitle": "Descubra a palavra do atendimento",
        "kind": "word",
        "words": [
            "CANAL", "FILAS", "PRAZO", "CHURN", "TURNO", "PAUSA", "CRISE", "FLUXO", "PLANO", "VENDA",
            "VALOR", "TEMPO", "METAS", "TOQUE", "REDES", "MARCA", "CONTA", "RADAR", "TRATO", "FALAR",
            "ABRIR", "TEXTO", "QUEDA", "CURVA", "SALDO", "ORDEM", "MULTA", "SENHA", "RISCO", "CARTA",
            "CAMPO", "FORMA", "LOGIN", "NORTE", "PONTO", "FRETE", "MACRO", "BREVE", "SQUAD", "COACH",
            "CAUSA", "FUNDO", "FONTE", "GASTO", "PLANO", "PORTA", "FATOR", "CLASSE", "SEGUE", "TURMA",
        ],
        "max_score": 100,
    },
    "conexo-cx": {
        "id": "conexo-cx",
        "title": "Conexo CX",
        "subtitle": "Agrupe palavras por tema",
        "kind": "groups",
        "max_mistakes": 4,
        "categories": [
            {"id": "canais", "label": "Canais de atendimento", "difficulty": "Facil", "words": ["CHAT", "EMAIL", "FONE", "REDES"]},
            {"id": "metricas", "label": "Siglas de metricas", "difficulty": "Medio", "words": ["NPS", "FCR", "SLA", "TMA"]},
            {"id": "estado-cliente", "label": "O cliente esta ___", "difficulty": "Dificil", "words": ["BRAVO", "ANSIOSO", "PERDIDO", "CONFUSO"]},
            {"id": "tipo-atendimento", "label": "___ atendimento", "difficulty": "Expert", "words": ["ATIVO", "OMNI", "HIBRIDO", "REMOTO"]},
        ],
    },
    "quem-disse-cx": {
        "id": "quem-disse-cx",
        "title": "Quem Disse?",
        "subtitle": "Identifique o perfil do cliente",
        "kind": "quiz",
        "profiles": {
            "BRAVO": {"label": "Bravo", "desc": "Emotivamente carregado, exigente, no limite"},
            "ANSIOSO": {"label": "Ansioso", "desc": "Busca seguranca e previsibilidade"},
            "CONFUSO": {"label": "Confuso", "desc": "Precisa de orientacao e clareza"},
            "FIEL": {"label": "Fiel", "desc": "Historico positivo, decepcionado mas respeitoso"},
        },
        "questions": [
            {
                "quote": "Ja liguei 3 vezes essa semana e ninguem resolve nada! Isso e uma total bagunca!",
                "channel": "Telefone",
                "correct": "BRAVO",
                "points": 100,
                "explanation": "A repeticao frustrada e o tom acusatorio indicam um cliente no limite da paciencia.",
            },
            {
                "quote": "Desculpa incomodar... queria so saber se tem alguma previsao de quando resolve?",
                "channel": "Chat",
                "correct": "ANSIOSO",
                "points": 100,
                "explanation": "O foco em prazo revela ansiedade; esse cliente precisa de seguranca e atualizacoes frequentes.",
            },
            {
                "quote": "Nao entendo bem o que aconteceu. Voce pode me explicar de um jeito mais simples?",
                "channel": "Email",
                "correct": "CONFUSO",
                "points": 100,
                "explanation": "Pedir explicacao simples e sinal classico de confusao no processo.",
            },
            {
                "quote": "Sempre fui bem atendido aqui, mas dessa vez fiquei surpreso com o prazo.",
                "channel": "Chat",
                "correct": "FIEL",
                "points": 150,
                "explanation": "Mencionar historico positivo antes da critica e marca de cliente fiel.",
            },
            {
                "quote": "Tudo bem, pode demorar. So preciso saber se vao me avisar quando resolver.",
                "channel": "WhatsApp",
                "correct": "ANSIOSO",
                "points": 150,
                "explanation": "Parece calmo, mas o foco em aviso e previsibilidade revela ansiedade.",
            },
            {
                "quote": "Voces sao um absurdo! Quero meu dinheiro de volta AGORA ou vou processar!",
                "channel": "Redes Sociais",
                "correct": "BRAVO",
                "points": 100,
                "explanation": "Linguagem agressiva, demanda imediata e ameaca judicial indicam raiva em pico emocional.",
            },
            {
                "quote": "Nao sei se fiz certo... tentei cadastrar pelo app mas nao sei se funcionou.",
                "channel": "Telefone",
                "correct": "CONFUSO",
                "points": 100,
                "explanation": "A incerteza sobre a propria acao e o centro do perfil confuso.",
            },
            {
                "quote": "Compro aqui ha 7 anos. Nunca precisei reclamar, mas quando precisei foi muito dificil.",
                "channel": "Email",
                "correct": "FIEL",
                "points": 100,
                "explanation": "Historico longo e decepcao mostram uma relacao que ainda pode ser preservada.",
            },
            {
                "quote": "Pode colocar na fila, nao tem pressa. Mas voce tem certeza que vai resolver mesmo?",
                "channel": "Chat",
                "correct": "ANSIOSO",
                "points": 150,
                "explanation": "A pergunta por garantia contradiz a aparente paciencia e aponta ansiedade.",
            },
            {
                "quote": "Esse produto veio errado, mas entendo que pode acontecer. Quero so trocar, por favor.",
                "channel": "WhatsApp",
                "correct": "FIEL",
                "points": 100,
                "explanation": "Normalizar o erro antes de pedir solucao mostra maturidade de relacionamento.",
            },
        ],
    },
    "sequencia-cx": {
        "id": "sequencia-cx",
        "title": "Sequencia CX",
        "subtitle": "Monte a ordem correta do atendimento",
        "kind": "sequence",
        "sequences": [
            {
                "id": "atendimento-padrao",
                "title": "Atendimento Padrao",
                "context": "Cliente entra em contato pelo chat com uma duvida sobre a fatura.",
                "difficulty": "Facil",
                "steps": [
                    {"id": "a", "text": "Saudar e identificar o cliente"},
                    {"id": "b", "text": "Escutar ativamente o problema"},
                    {"id": "c", "text": "Confirmar o entendimento da demanda"},
                    {"id": "d", "text": "Apresentar a solucao"},
                    {"id": "e", "text": "Verificar se o cliente ficou satisfeito"},
                    {"id": "f", "text": "Encerrar o atendimento e registrar"},
                ],
                "explanation": "Acolher, entender, confirmar, resolver, validar e fechar reduzem recontato.",
            },
            {
                "id": "cliente-bravo",
                "title": "Cliente Bravo",
                "context": "Cliente liga furioso porque seu pedido atrasou 5 dias sem aviso previo.",
                "difficulty": "Medio",
                "steps": [
                    {"id": "a", "text": "Deixar o cliente falar sem interromper"},
                    {"id": "b", "text": "Reconhecer a falha e pedir desculpas"},
                    {"id": "c", "text": "Investigar o que aconteceu"},
                    {"id": "d", "text": "Oferecer solucao concreta e prazo claro"},
                    {"id": "e", "text": "Confirmar com o cliente se aceita a solucao"},
                    {"id": "f", "text": "Fazer follow-up apos resolucao"},
                ],
                "explanation": "Com cliente bravo, escuta vem antes da solucao.",
            },
            {
                "id": "escalonamento",
                "title": "Escalonamento",
                "context": "Agente nao consegue resolver um problema tecnico e precisa escalar.",
                "difficulty": "Medio",
                "steps": [
                    {"id": "a", "text": "Informar que vai acionar o time especializado"},
                    {"id": "b", "text": "Passar o contexto completo ao proximo nivel"},
                    {"id": "c", "text": "Garantir que o cliente nao repita o problema"},
                    {"id": "d", "text": "Estabelecer prazo de retorno claro"},
                    {"id": "e", "text": "Registrar o escalonamento no sistema"},
                    {"id": "f", "text": "Monitorar ate a resolucao final"},
                ],
                "explanation": "Escalonamento transparente evita repeticao e perda de contexto.",
            },
            {
                "id": "pesquisa-satisfacao",
                "title": "Pesquisa de Satisfacao",
                "context": "Apos resolver um ticket, a equipe quer coletar feedback.",
                "difficulty": "Facil",
                "steps": [
                    {"id": "a", "text": "Aguardar a resolucao completa do problema"},
                    {"id": "b", "text": "Escolher o canal adequado para o perfil"},
                    {"id": "c", "text": "Enviar pesquisa em ate 24h apos o fechamento"},
                    {"id": "d", "text": "Analisar as respostas recebidas"},
                    {"id": "e", "text": "Agir sobre os pontos negativos levantados"},
                    {"id": "f", "text": "Fechar o loop com o cliente insatisfeito"},
                ],
                "explanation": "Pesquisa so tem valor quando gera acao e fechamento de loop.",
            },
            {
                "id": "onboarding-cliente",
                "title": "Onboarding de Cliente",
                "context": "Cliente acabou de contratar o servico e precisa ser ativado.",
                "difficulty": "Dificil",
                "steps": [
                    {"id": "a", "text": "Boas-vindas e apresentacao do suporte"},
                    {"id": "b", "text": "Entender os objetivos do cliente"},
                    {"id": "c", "text": "Configurar conta conforme o perfil"},
                    {"id": "d", "text": "Realizar treinamento guiado"},
                    {"id": "e", "text": "Definir KPIs de sucesso com o cliente"},
                    {"id": "f", "text": "Agendar check-in dos primeiros 30 dias"},
                ],
                "explanation": "Onboarding bem feito reduz churn no primeiro trimestre.",
            },
            {
                "id": "reclamacao-formal",
                "title": "Resolucao de Reclamacao Formal",
                "context": "Cliente enviou reclamacao formal sobre cobranca indevida.",
                "difficulty": "Dificil",
                "steps": [
                    {"id": "a", "text": "Registrar e priorizar a reclamacao internamente"},
                    {"id": "b", "text": "Responder publicamente com empatia em ate 24h"},
                    {"id": "c", "text": "Entrar em contato direto com o cliente"},
                    {"id": "d", "text": "Investigar a cobranca e identificar causa raiz"},
                    {"id": "e", "text": "Oferecer estorno e compensacao proporcional"},
                    {"id": "f", "text": "Solicitar atualizacao da avaliacao apos resolucao"},
                ],
                "explanation": "Resposta publica, solucao privada e causa raiz protegem a relacao.",
            },
        ],
    },

    "termo-ex": {
        "id": "termo-ex",
        "title": "Termo EX",
        "subtitle": "Descubra a palavra da experiencia do colaborador",
        "kind": "word",
        "words": [
            "CLIMA", "CARGO", "METAS", "PAUSA", "BONUS", "LIDER", "VERBA", "TURNO", "SALDO", "FOLGA",
            "VAGAS", "PLANO", "CURSO", "CALMA", "RAMAL", "SETOR", "NORMA", "VALOR", "GRUPO", "UNIAO",
            "PRAZO", "FLUXO", "ESCOP", "TRILH", "EQUIP", "FOCOS", "AGEND", "RITMO", "PODER", "GANHO",
        ],
        "max_score": 100,
    },
    "conexo-ex": {
        "id": "conexo-ex",
        "title": "Conexo EX",
        "subtitle": "Agrupe palavras da experiencia do colaborador",
        "kind": "groups",
        "max_mistakes": 4,
        "categories": [
            {"id": "beneficios", "label": "Beneficios", "difficulty": "Facil", "words": ["VALE", "BONUS", "PLANO", "FOLGA"]},
            {"id": "lideranca", "label": "Lideranca", "difficulty": "Medio", "words": ["MENTOR", "ESCUTA", "EXEMPLO", "DELEGA"]},
            {"id": "clima", "label": "Clima e cultura", "difficulty": "Dificil", "words": ["RESPEITO", "CONFIANCA", "UNIAO", "PROPOSITO"]},
            {"id": "desenvolvimento", "label": "Desenvolvimento", "difficulty": "Expert", "words": ["CURSO", "TRILHA", "META", "FEEDBACK"]},
        ],
    },
    "quem-disse-ex": {
        "id": "quem-disse-ex",
        "title": "Quem Disse?",
        "subtitle": "Identifique o perfil do colaborador",
        "kind": "quiz",
        "profiles": {
            "ENGAJADO": {"label": "Engajado", "desc": "Motivado, propoe ideias, veste a camisa"},
            "DESMOTIVADO": {"label": "Desmotivado", "desc": "Desconectado do proposito, em risco de churn"},
            "NOVATO": {"label": "Novato", "desc": "Recem-chegado, ainda buscando referencias"},
            "VETERANO": {"label": "Veterano", "desc": "Experiente, memoria da casa, exigente"},
        },
        "questions": [
            {"quote": "Topo pegar esse projeto novo! Acho que dá pra melhorar bastante o processo.", "channel": "Reuniao 1:1", "correct": "ENGAJADO", "points": 100, "explanation": "Iniciativa e visao de melhoria sao marcas de engajamento."},
            {"quote": "Faco o que pedem, mas sinceramente nao vejo mais sentido no que entrego.", "channel": "Pesquisa de clima", "correct": "DESMOTIVADO", "points": 100, "explanation": "Perda de proposito e o principal sinal de desmotivacao."},
            {"quote": "Desculpa a duvida basica, mas onde eu registro minhas horas mesmo?", "channel": "Chat interno", "correct": "NOVATO", "points": 100, "explanation": "Duvidas operacionais simples sao tipicas de quem chegou ha pouco."},
            {"quote": "Ja vi essa mudanca acontecer 3 vezes aqui. Da ultima nao funcionou bem.", "channel": "Reuniao de time", "correct": "VETERANO", "points": 150, "explanation": "Memoria historica da empresa e marca do veterano."},
        ],
    },
    "sequencia-ex": {
        "id": "sequencia-ex",
        "title": "Sequencia EX",
        "subtitle": "Monte a ordem correta dos processos de RH",
        "kind": "sequence",
        "sequences": [
            {
                "id": "onboarding-colaborador", "title": "Onboarding de Colaborador", "difficulty": "Facil",
                "context": "Novo colaborador comeca na segunda-feira e precisa ser integrado.",
                "steps": [
                    {"id": "a", "text": "Preparar acessos e equipamentos antes do dia 1"},
                    {"id": "b", "text": "Dar as boas-vindas e apresentar o time"},
                    {"id": "c", "text": "Explicar cultura, valores e expectativas"},
                    {"id": "d", "text": "Definir buddy/padrinho de apoio"},
                    {"id": "e", "text": "Alinhar metas dos primeiros 90 dias"},
                    {"id": "f", "text": "Agendar check-in da primeira semana"},
                ],
                "explanation": "Onboarding estruturado acelera produtividade e retencao.",
            },
            {
                "id": "feedback-1a1", "title": "Feedback 1:1", "difficulty": "Medio",
                "context": "Lider vai dar um feedback de melhoria para um liderado.",
                "steps": [
                    {"id": "a", "text": "Preparar exemplos concretos e recentes"},
                    {"id": "b", "text": "Criar ambiente seguro e privado"},
                    {"id": "c", "text": "Descrever o comportamento, nao a pessoa"},
                    {"id": "d", "text": "Ouvir a perspectiva do colaborador"},
                    {"id": "e", "text": "Combinar acoes concretas de melhoria"},
                    {"id": "f", "text": "Agendar acompanhamento do progresso"},
                ],
                "explanation": "Feedback bom e especifico, bidirecional e gera plano de acao.",
            },
            {
                "id": "resolucao-conflito", "title": "Resolucao de Conflito", "difficulty": "Dificil",
                "context": "Duas pessoas do time estao em conflito e a entrega esta travada.",
                "steps": [
                    {"id": "a", "text": "Conversar com cada parte separadamente"},
                    {"id": "b", "text": "Identificar a causa raiz do conflito"},
                    {"id": "c", "text": "Mediar uma conversa entre as partes"},
                    {"id": "d", "text": "Focar no problema, nao em culpados"},
                    {"id": "e", "text": "Acordar combinados claros de convivencia"},
                    {"id": "f", "text": "Acompanhar a relacao nas semanas seguintes"},
                ],
                "explanation": "Mediacao imparcial e foco no problema preservam o time.",
            },
            {
                "id": "plano-desenvolvimento", "title": "Plano de Desenvolvimento", "difficulty": "Dificil",
                "context": "Colaborador quer crescer e pediu um plano de carreira.",
                "steps": [
                    {"id": "a", "text": "Mapear forcas e pontos de desenvolvimento"},
                    {"id": "b", "text": "Alinhar aspiracoes de carreira do colaborador"},
                    {"id": "c", "text": "Definir competencias-alvo"},
                    {"id": "d", "text": "Escolher acoes (cursos, projetos, mentoria)"},
                    {"id": "e", "text": "Definir metas e prazos mensuraveis"},
                    {"id": "f", "text": "Revisar o PDI periodicamente"},
                ],
                "explanation": "PDI conecta aspiracao do colaborador com necessidade da empresa.",
            },
        ],
    },
}


BASE_XP_BY_LEVEL = {1: 40, 2: 60, 3: 80}
INTERMISSION_SESSION_VERSION = 3
INTERMISSION_MANIFEST_SCHEMA_VERSION = 3
TERMO_MAX_HINTS = 3

# Posicoes FIXAS por nivel (22 etapas). Sentury (lg/txt) e Intermission (ig) ancorados;
# os desafios sel- preenchem o resto. Ancoras nunca caem nem ficam adjacentes (gaps >=3).
# L1/L2: 1 Sentury + 2 Intermission (+19 sel). L3: 2 Sentury + 2 Intermission (+18 sel).
ANCHORS_BY_LEVEL: Dict[int, Dict[str, Any]] = {
    1: {"sentury": [4], "intermission": [9, 16], "total": 22},
    2: {"sentury": [4], "intermission": [9, 16], "total": 22},
    3: {"sentury": [4, 13], "intermission": [8, 18], "total": 22},
}


def _base64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def _base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


class IntermissionService:
    """Builds manifests, signs game sessions, and recalculates game score."""

    def __init__(self, secret: str, manifest_salt: str = "cxgame-intermission-v1"):
        if not secret:
            raise ValueError("IntermissionService requires a secret")
        self.secret = secret.encode("utf-8")
        self.manifest_salt = manifest_salt

    def anchor_layout_for_level(self, level: int) -> Dict[str, Any]:
        """Posicoes fixas (Sentury + Intermission) para o nivel. Fallback p/ L1."""
        return ANCHORS_BY_LEVEL.get(int(level), ANCHORS_BY_LEVEL[1])

    def build_manifest(
        self,
        user_id: str,
        season_id: str,
        level: int,
        challenge_ids: List[str],
        setor: str = "CX",
        anchor_layout: Optional[Dict[str, Any]] = None,
        phase_generation: Optional[str] = None,
    ) -> Dict[str, Any]:
        clean_challenge_ids = [challenge_id for challenge_id in challenge_ids if challenge_id]
        generation = str(phase_generation or "legacy")
        manifest_id = self._manifest_id(user_id, season_id, level, clean_challenge_ids, generation)
        selected_games = self._select_games(user_id, season_id, level, generation, setor)

        nodes: List[Dict[str, Any]] = []
        slot_index = 1

        def _challenge_node(cid: str) -> Dict[str, Any]:
            return {"node_id": f"challenge:{cid}", "type": "challenge", "challenge_id": cid}

        def _append_game_node() -> None:
            nonlocal slot_index
            game_id = self._canonical_game_id(selected_games[(slot_index - 1) % len(selected_games)])
            if not game_id:
                return
            synthetic_id = f"game:L{level}:slot{slot_index}:{game_id}"
            nodes.append({
                "node_id": synthetic_id,
                "type": "game",
                "game_id": game_id,
                "slot_index": slot_index,
                "flow_challenge_id": self._flow_challenge_id(level, slot_index),
                "synthetic_challenge_id": synthetic_id,
                "completed_minigame_id": f"intermission:{game_id}:L{level}:slot{slot_index}",
                "base_xp": BASE_XP_BY_LEVEL.get(level, 40),
            })
            slot_index += 1

        if anchor_layout:
            # Posicoes FIXAS: Sentury (lg/txt) e Intermission em estagios definidos;
            # os desafios sel- preenchem o resto. Ancoras nunca caem nem ficam coladas.
            sentury_positions = set(anchor_layout.get("sentury", []))
            intermission_positions = set(anchor_layout.get("intermission", []))
            total = int(anchor_layout.get("total") or (len(clean_challenge_ids) + len(intermission_positions)))
            logun_ids = [c for c in clean_challenge_ids if c.startswith(("lg-", "txt-"))]
            sel_ids = [c for c in clean_challenge_ids if not c.startswith(("lg-", "txt-"))]
            for position in range(1, total + 1):
                if position in sentury_positions and logun_ids:
                    nodes.append(_challenge_node(logun_ids.pop(0)))
                elif position in intermission_positions and selected_games:
                    _append_game_node()
                elif sel_ids:
                    nodes.append(_challenge_node(sel_ids.pop(0)))
            # Defensivo: se sobrar conteudo (contagem divergente), anexa ao fim sem perder.
            for cid in logun_ids + sel_ids:
                nodes.append(_challenge_node(cid))
        else:
            insert_after = set(self._slot_insert_positions(len(clean_challenge_ids)))
            for position, challenge_id in enumerate(clean_challenge_ids, start=1):
                nodes.append(_challenge_node(challenge_id))
                if position in insert_after and selected_games:
                    _append_game_node()

        for order_index, node in enumerate(nodes):
            node["order_index"] = order_index

        for order_index, node in enumerate(nodes):
            if node.get("type") != "game":
                continue

            next_node = nodes[order_index + 1] if order_index + 1 < len(nodes) else None
            session_payload = {
                "v": INTERMISSION_SESSION_VERSION,
                "user_id": user_id,
                "season_id": season_id,
                "manifest_id": manifest_id,
                "phase_generation": generation,
                "level": level,
                "setor": setor,
                "slot_index": node["slot_index"],
                "order_index": order_index,
                "game_id": node["game_id"],
                "flow_challenge_id": node["flow_challenge_id"],
                "synthetic_challenge_id": node["synthetic_challenge_id"],
                "completed_minigame_id": node["completed_minigame_id"],
                "base_xp": node["base_xp"],
                "next_node_type": next_node.get("type") if next_node else None,
                "next_challenge_id": next_node.get("challenge_id") if next_node and next_node.get("type") == "challenge" else None,
                "seed": self._seed(user_id, season_id, level, generation, node["slot_index"], node["game_id"]),
            }
            node["session_id"] = self.create_session_id(session_payload)
            node["_session_payload"] = session_payload

        return {
            "schema_version": INTERMISSION_MANIFEST_SCHEMA_VERSION,
            "manifest_id": manifest_id,
            "phase_generation": generation,
            "user_id": user_id,
            "season_id": season_id,
            "level": level,
            "setor": setor,
            "total_nodes": len(nodes),
            "nodes": nodes,
        }

    def create_session_id(self, payload: Dict[str, Any]) -> str:
        digest = hmac.new(
            self.secret,
            self._serialize_session_payload(payload).encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return f"igv2_{digest[:40]}"

    def verify_session_id(self, session_id: str) -> Dict[str, Any]:
        if session_id.startswith("igv2_"):
            raise ValueError("Opaque intermission session ids must be resolved from cache")
        if not session_id.startswith("ig_") or "." not in session_id:
            raise ValueError("Invalid intermission session id")

        encoded_payload, signature = session_id[3:].split(".", 1)
        expected_signature = self._sign(encoded_payload)
        if not hmac.compare_digest(signature, expected_signature):
            raise ValueError("Invalid intermission session signature")

        payload = json.loads(_base64url_decode(encoded_payload).decode("utf-8"))
        return self.normalize_session_payload(payload)

    def normalize_session_payload(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        payload = dict(payload or {})
        payload["game_id"] = self._canonical_game_id(payload.get("game_id"))
        payload["manifest_id"] = payload.get("manifest_id")
        payload["phase_generation"] = str(payload.get("phase_generation") or "legacy")
        payload["order_index"] = int(payload.get("order_index", 0) or 0)
        payload["level"] = int(payload.get("level", 1) or 1)
        payload["slot_index"] = int(payload.get("slot_index", 1) or 1)
        payload["base_xp"] = int(payload.get("base_xp", BASE_XP_BY_LEVEL.get(payload["level"], 40)) or 0)
        if not payload.get("flow_challenge_id"):
            payload["flow_challenge_id"] = self._flow_challenge_id(
                payload["level"],
                payload["slot_index"],
            )
        if payload.get("game_id") not in GAME_CATALOG:
            raise ValueError("Unknown intermission game")
        return payload

    def _flow_challenge_id(self, level: int, slot_index: int) -> str:
        return f"ig-L{level}-slot{slot_index}"

    def build_navigation_for_manifest(
        self,
        manifest: Optional[Dict[str, Any]],
        order_index: int,
        phase_session_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        nodes = manifest.get("nodes") if isinstance(manifest, dict) else []
        next_node = next(
            (node for node in (nodes or []) if int(node.get("order_index", -1)) > int(order_index)),
            None,
        )
        if phase_session_id is None and isinstance(manifest, dict):
            phase_session_id = manifest.get("phase_session_id")
        return self._build_navigation(next_node, phase_session_id)

    def build_navigation_from_session_payload(self, session_payload: Dict[str, Any]) -> Dict[str, Any]:
        phase_session_id = session_payload.get("phase_session_id")
        next_node_type = session_payload.get("next_node_type")
        next_challenge_id = session_payload.get("next_challenge_id")

        if next_node_type == "challenge" and next_challenge_id:
            next_node = {
                "type": "challenge",
                "challenge_id": next_challenge_id,
            }
            return self._build_navigation(next_node, phase_session_id)

        return self._build_navigation(None, phase_session_id)

    def _build_navigation(
        self,
        next_node: Optional[Dict[str, Any]],
        phase_session_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not next_node:
            return {
                "next_node": None,
                "next_target": "home.html",
            }

        def _with_phase(query: str) -> str:
            # A VPS e dona do fluxo: o phase token viaja junto no target para que
            # o frontend nunca precise re-derivar a sessao de fase no cliente.
            if phase_session_id:
                return f"{query}&phase_session_id={phase_session_id}"
            return query

        if next_node.get("type") == "game":
            flow_challenge_id = next_node.get("flow_challenge_id")
            session_id = next_node.get("session_id")
            if session_id:
                # Sessao de jogo opaca ja disponivel (auto-validada pela VPS).
                next_target = f"challenge.html?game_session_id={session_id}"
            elif flow_challenge_id:
                # Manifest saneado nao expoe session_id: rota pelo marcador ig- +
                # phase token, que o endpoint /resolve converte em game_session_id.
                next_target = _with_phase(f"challenge.html?id={flow_challenge_id}")
            else:
                next_target = "home.html"
            return {
                "next_node": {
                    "type": "game",
                    "session_id": session_id,
                    "flow_challenge_id": flow_challenge_id,
                    "order_index": next_node.get("order_index"),
                },
                "next_target": next_target,
            }

        return {
            "next_node": {
                "type": "challenge",
                "challenge_id": next_node.get("challenge_id"),
                "order_index": next_node.get("order_index"),
            },
            "next_target": _with_phase(f"challenge.html?id={next_node.get('challenge_id')}"),
        }

    def get_game_config(self, game_id: str, session_payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        canonical_game_id = self._canonical_game_id(game_id)
        if canonical_game_id not in GAME_CATALOG:
            raise ValueError("Unknown game")

        config = copy.deepcopy(GAME_CATALOG[canonical_game_id])
        if config.get("kind") == "word" and session_payload:
            target = self._termo_target(session_payload)
            config["word_length"] = len(target)
            config["max_attempts"] = 6
            config.pop("words", None)
        return config

    def score_game(
        self,
        game_id: str,
        result_payload: Dict[str, Any],
        session_payload: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, int]:
        canonical_game_id = self._canonical_game_id(game_id)
        kind = GAME_CATALOG.get(canonical_game_id, {}).get("kind")
        if kind == "quiz":
            return self._score_quem_disse(result_payload, canonical_game_id)
        if kind == "sequence":
            return self._score_sequencia(result_payload, canonical_game_id)
        if kind == "groups":
            return self._score_conexo(result_payload, canonical_game_id)
        if kind == "word":
            return self._score_termo(result_payload, session_payload)
        raise ValueError("Unknown game")

    def summarize_result(
        self,
        game_id: str,
        result_payload: Dict[str, Any],
        score: Dict[str, int],
        session_payload: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        canonical_game_id = self._canonical_game_id(game_id)
        percent = int(score.get("percent") or 0)
        summary: Dict[str, Any] = {
            "outcome": "hit" if percent >= 60 else "miss",
            "percent": percent,
        }

        kind = GAME_CATALOG.get(canonical_game_id, {}).get("kind")
        catalog_entry = GAME_CATALOG.get(canonical_game_id, {})
        if kind == "word":
            target = self._termo_target(session_payload or {})
            guesses = [str(guess).upper() for guess in (result_payload.get("guesses") or [])][:6]
            won = target in guesses
            summary.update({
                "outcome": "hit" if won else "miss",
                "attempts_used": len(guesses),
                "total_attempts": 6,
                "revealed_answer": target,
                "final_guess": guesses[-1] if guesses else "",
            })
        elif kind == "groups":
            groups = result_payload.get("groups") or []
            summary.update({
                "groups_found": len(groups),
                "total_groups": len(catalog_entry.get("categories", [])),
                "mistakes": max(0, int(result_payload.get("mistakes") or 0)),
            })
        elif kind == "quiz":
            answers = result_payload.get("answers") or []
            summary.update({
                "attempts_used": len(answers),
                "total_questions": len(catalog_entry.get("questions", [])),
            })
        elif kind == "sequence":
            submissions = result_payload.get("sequences") or []
            summary.update({
                "rounds_played": len(submissions),
                "total_rounds": len(catalog_entry.get("sequences", [])),
            })

        return summary

    def award_xp(self, base_xp: int, percent: int) -> int:
        bounded_percent = max(0, min(100, int(percent or 0)))
        return math.floor(max(0, int(base_xp or 0)) * bounded_percent / 100)

    def _select_games(self, user_id: str, season_id: str, level: int, phase_generation: str = "legacy", setor: str = "CX") -> List[str]:
        pool = ACTIVE_GAMES_BY_SETOR.get(str(setor or "CX").upper(), ACTIVE_GAMES_BY_SETOR["CX"])
        catalog = sorted(pool)
        rng = random.Random(self._seed(user_id, season_id, level, phase_generation, "games"))
        rng.shuffle(catalog)
        return catalog[:2]  # 2 games DISTINTOS por nivel (um game cai no maximo 1x/nivel)

    def _canonical_game_id(self, game_id: Optional[str]) -> Optional[str]:
        if game_id is None:
            return None
        return GAME_ALIASES.get(game_id, game_id)

    def _slot_insert_positions(self, challenge_count: int) -> List[int]:
        if challenge_count <= 0:
            return []
        first = max(1, min(challenge_count, round(challenge_count * 0.4)))
        second = max(first + 1, min(challenge_count, round(challenge_count * 0.8)))
        if second > challenge_count:
            second = challenge_count
        return [first, second]

    def _seed(self, *parts: Any) -> int:
        raw = "|".join(str(part) for part in (self.manifest_salt, *parts))
        return int(hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16], 16)

    def _manifest_id(self, user_id: str, season_id: str, level: int, challenge_ids: List[str], phase_generation: str = "legacy") -> str:
        raw = json.dumps([user_id, season_id, level, phase_generation, challenge_ids], separators=(",", ":"))
        digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]
        return f"im_{digest}"

    def _serialize_session_payload(self, payload: Dict[str, Any]) -> str:
        return json.dumps(payload, sort_keys=True, separators=(",", ":"))

    def _sign(self, encoded_payload: str) -> str:
        digest = hmac.new(self.secret, encoded_payload.encode("utf-8"), hashlib.sha256).digest()
        return _base64url_encode(digest)

    def _score_quem_disse(self, result_payload: Dict[str, Any], game_id: str = "quem-disse-cx") -> Dict[str, int]:
        answers = result_payload.get("answers") or []
        questions = GAME_CATALOG.get(game_id, GAME_CATALOG["quem-disse-cx"])["questions"]
        max_score = sum(int(question["points"]) for question in questions)
        score = 0

        for index, question in enumerate(questions):
            answer = answers[index] if index < len(answers) else None
            if isinstance(answer, dict):
                answer = answer.get("profile")
            if answer == question["correct"]:
                score += int(question["points"])

        return self._score_result(score, max_score)

    def _score_sequencia(self, result_payload: Dict[str, Any], game_id: str = "sequencia-cx") -> Dict[str, int]:
        submissions = result_payload.get("sequences") or []
        sequences = GAME_CATALOG.get(game_id, GAME_CATALOG["sequencia-cx"])["sequences"]
        max_score = len(sequences) * 200
        score = 0

        for index, sequence in enumerate(sequences):
            submitted = submissions[index] if index < len(submissions) else []
            if isinstance(submitted, dict):
                submitted = submitted.get("order") or []
            correct_order = [step["id"] for step in sequence["steps"]]
            correct_positions = sum(1 for pos, step_id in enumerate(submitted[:len(correct_order)]) if step_id == correct_order[pos])
            pct = round((correct_positions / len(correct_order)) * 100)
            if pct == 100:
                score += 200
            elif pct >= 66:
                score += 100
            elif pct >= 33:
                score += 50

        return self._score_result(score, max_score)

    def _score_conexo(self, result_payload: Dict[str, Any], game_id: str = "conexo-cx") -> Dict[str, int]:
        groups = result_payload.get("groups") or []
        categories = GAME_CATALOG.get(game_id, GAME_CATALOG["conexo-cx"])["categories"]
        max_score = len(categories) * 100
        score = 0

        normalized_groups = [set(group.get("words", group) if isinstance(group, dict) else group) for group in groups if isinstance(group, (dict, list))]
        for category in categories:
            expected = set(category["words"])
            if any(group == expected for group in normalized_groups):
                score += 100

        mistakes = max(0, int(result_payload.get("mistakes") or 0))
        score = max(0, score - mistakes * 10)
        return self._score_result(score, max_score)

    def _score_termo(self, result_payload: Dict[str, Any], session_payload: Optional[Dict[str, Any]]) -> Dict[str, int]:
        target = self._termo_target(session_payload or {})
        guesses = [str(guess).upper() for guess in (result_payload.get("guesses") or [])][:6]
        max_score = 100

        try:
            won_at = guesses.index(target) + 1
        except ValueError:
            won_at = 0

        if won_at:
            score = max(25, 115 - won_at * 15)
        else:
            score = 10 if guesses else 0

        return self._score_result(score, max_score)

    def _termo_target(self, session_payload: Dict[str, Any]) -> str:
        game_id = self._canonical_game_id(session_payload.get("game_id")) or "termo-cx"
        entry = GAME_CATALOG.get(game_id) or GAME_CATALOG["termo-cx"]
        # so palavras de 5 letras, sem duplicatas (defensivo contra lixo na lista)
        words = list(dict.fromkeys(w for w in (entry.get("words") or []) if len(w) == 5))
        if not words:
            words = list(dict.fromkeys(w for w in GAME_CATALOG["termo-cx"]["words"] if len(w) == 5))
        # Anti-repeat: embaralha por (user, season, game, generation) e indexa pelo NIVEL.
        # Um game cai no maximo 1x/nivel -> L1/L2/L3 pegam palavras DISTINTAS (sem colisao).
        user_id = session_payload.get("user_id")
        level = session_payload.get("level")
        if user_id is not None and level is not None:
            shuffled = list(words)
            random.Random(self._seed(
                user_id, session_payload.get("season_id"), game_id,
                session_payload.get("phase_generation", "legacy"), "termo-words",
            )).shuffle(shuffled)
            return shuffled[(int(level) - 1) % len(shuffled)]
        seed = int(session_payload.get("seed") or 0)
        return words[seed % len(words)]

    def sanitize_termo_guess(self, guess: Any, word_length: int = 5) -> str:
        normalized = re.sub(r"[^A-Z]", "", str(guess or "").upper())
        if len(normalized) != word_length:
            raise ValueError(f"Use exatamente {word_length} letras.")
        return normalized

    def build_termo_feedback(self, target: str, guess: str) -> List[str]:
        target = str(target or "").upper()
        guess = str(guess or "").upper()
        if len(target) != len(guess):
            raise ValueError("Target and guess must have the same length")

        feedback = ["absent"] * len(target)
        remaining: Dict[str, int] = {}

        for index, letter in enumerate(target):
            if guess[index] == letter:
                feedback[index] = "correct"
            else:
                remaining[letter] = remaining.get(letter, 0) + 1

        for index, letter in enumerate(guess):
            if feedback[index] == "correct":
                continue
            if remaining.get(letter, 0) > 0:
                feedback[index] = "present"
                remaining[letter] -= 1

        return feedback

    def create_termo_state(self, session_payload: Dict[str, Any], max_attempts: int = 6) -> Dict[str, Any]:
        target = self._termo_target(session_payload)
        return {
            "target_word": target,
            "word_length": len(target),
            "max_attempts": max_attempts,
            "max_hints": TERMO_MAX_HINTS,
            "hints_used": 0,
            "revealed_positions": [],
            "guesses": [],
            "completed": False,
            "outcome": None,
            "final_answer": None,
        }

    def public_termo_state(self, state: Dict[str, Any]) -> Dict[str, Any]:
        public_state = dict(state or {})
        target = str(public_state.get("target_word") or "")
        revealed_positions = [
            int(position)
            for position in (public_state.get("revealed_positions") or [])
            if isinstance(position, int) or str(position).isdigit()
        ]
        public_state["revealed_letters"] = [
            {
                "position": position,
                "letter": target[position],
            }
            for position in revealed_positions
            if 0 <= position < len(target)
        ]
        public_state.pop("target_word", None)
        public_state["attempts_used"] = len(public_state.get("guesses") or [])
        if not public_state.get("completed"):
            public_state["final_answer"] = None
        return public_state

    def apply_termo_guess(self, session_payload: Dict[str, Any], state: Dict[str, Any], guess: Any) -> Dict[str, Any]:
        normalized_state = dict(state or {})
        target = normalized_state.get("target_word") or self._termo_target(session_payload)
        normalized_state.setdefault("target_word", target)
        normalized_state.setdefault("word_length", len(target))
        normalized_state.setdefault("max_attempts", 6)
        normalized_state.setdefault("max_hints", TERMO_MAX_HINTS)
        normalized_state.setdefault("hints_used", 0)
        normalized_state.setdefault("revealed_positions", [])
        normalized_state.setdefault("guesses", [])
        normalized_state.setdefault("completed", False)
        normalized_state.setdefault("outcome", None)
        normalized_state.setdefault("final_answer", None)

        if normalized_state["completed"]:
            return normalized_state

        normalized_guess = self.sanitize_termo_guess(guess, normalized_state["word_length"])
        feedback = self.build_termo_feedback(target, normalized_guess)

        normalized_state["guesses"].append({
            "word": normalized_guess,
            "feedback": feedback,
        })

        has_won = normalized_guess == target
        exhausted = len(normalized_state["guesses"]) >= int(normalized_state["max_attempts"] or 6)
        if has_won or exhausted:
            normalized_state["completed"] = True
            normalized_state["outcome"] = "hit" if has_won else "miss"
            normalized_state["final_answer"] = target

        return normalized_state

    def apply_termo_hint(self, session_payload: Dict[str, Any], state: Dict[str, Any]) -> tuple[Dict[str, Any], Dict[str, Any]]:
        normalized_state = dict(state or {})
        target = normalized_state.get("target_word") or self._termo_target(session_payload)
        normalized_state.setdefault("target_word", target)
        normalized_state.setdefault("word_length", len(target))
        normalized_state.setdefault("max_attempts", 6)
        normalized_state.setdefault("max_hints", TERMO_MAX_HINTS)
        normalized_state.setdefault("hints_used", 0)
        normalized_state.setdefault("revealed_positions", [])
        normalized_state.setdefault("guesses", [])
        normalized_state.setdefault("completed", False)
        normalized_state.setdefault("outcome", None)
        normalized_state.setdefault("final_answer", None)

        if normalized_state["completed"]:
            raise ValueError("Sessao ja concluida.")
        if int(normalized_state["hints_used"] or 0) >= int(normalized_state["max_hints"] or TERMO_MAX_HINTS):
            raise ValueError("Sem dicas disponiveis.")

        revealed_positions = list(normalized_state.get("revealed_positions") or [])
        next_position = next((index for index in range(len(target)) if index not in revealed_positions), None)
        if next_position is None:
            raise ValueError("Todas as letras ja foram reveladas.")

        revealed_positions.append(next_position)
        normalized_state["revealed_positions"] = revealed_positions
        normalized_state["hints_used"] = int(normalized_state.get("hints_used") or 0) + 1

        letter = target[next_position]
        return normalized_state, {
            "position": next_position,
            "letter": letter,
            "message": f"Letra {next_position + 1}: {letter}"
        }

    def _score_result(self, score: int, max_score: int) -> Dict[str, int]:
        bounded_score = max(0, min(int(score), int(max_score)))
        percent = round((bounded_score / max_score) * 100) if max_score else 0
        return {
            "score": bounded_score,
            "max_score": int(max_score),
            "percent": percent,
        }
