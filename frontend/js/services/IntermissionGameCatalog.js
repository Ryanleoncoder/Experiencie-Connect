(function initIntermissionGameCatalog(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.IntermissionGameCatalog = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function buildIntermissionGameCatalog() {
  const CX_COLOR = '#D85A30';
  const EX_COLOR = CX_COLOR;

  const GAME_ALIASES = {
    'quem-disse': 'quem-disse-cx'
  };

  const INTERMISSION_VISUAL_GAMES = [
    {
      id: 'termo-cx',
      type: 'cx',
      letter: 'T',
      name: 'Termo CX',
      desc: 'Adivinhe a palavra de CX em 6 tentativas',
      rule: 'Descubra a palavra de 5 letras em 6 tentativas',
      steps: [
        'Uma palavra secreta de 5 letras do universo CX e sorteada.',
        'Verde = certa no lugar. Amarelo = existe, lugar errado. Cinza = nao existe.',
        'Voce tem 6 tentativas para acertar.'
      ],
      tip: 'Comece com palavras que tenham vogais variadas, como CANAL ou TEMPO.'
    },
    {
      id: 'conexo-cx',
      type: 'cx',
      letter: 'C',
      name: 'Conexo CX',
      desc: 'Agrupe as palavras por categoria CX',
      rule: 'Encontre os grupos de palavras conectadas',
      steps: [
        '16 palavras do universo CX aparecem embaralhadas.',
        'Encontre os 4 grupos de 4 palavras com o mesmo tema.',
        'Selecione 4 palavras e confirme. Tentativas sao limitadas.'
      ],
      tip: 'Um grupo sempre vai parecer mais obvio. Comece por ele para eliminar palavras.'
    },
    {
      id: 'quem-disse-cx',
      type: 'cx',
      letter: 'Q',
      name: 'Quem Disse?',
      desc: 'Identifique quem fez a afirmacao',
      rule: 'Leia a frase e identifique o perfil correto',
      steps: [
        'Uma frase sobre CX aparece na tela.',
        'Identifique o perfil que combina com a mensagem.',
        'Cada acerto aumenta o score. Erros revelam a resposta correta.'
      ],
      tip: 'Palavras absolutas como nunca e sempre costumam sinalizar frustracao.'
    },
    {
      id: 'sequencia-cx',
      type: 'cx',
      letter: 'S',
      name: 'Sequencia CX',
      desc: 'Monte a ordem do fluxo de atendimento',
      rule: 'Ordene as etapas do atendimento',
      steps: [
        'Um cenario de atendimento e dividido em etapas embaralhadas.',
        'Escolha as etapas na ordem correta do fluxo.',
        'Acertar a ordem completa garante XP maximo.'
      ],
      tip: 'Reconhecer o problema vem sempre antes de propor a solucao.'
    },
    {
      id: 'termo-ex',
      type: 'ex',
      letter: 'T',
      name: 'Termo EX',
      desc: 'Adivinhe a palavra de EX em 6 tentativas',
      rule: 'Descubra a palavra de 5 letras em 6 tentativas',
      steps: [
        'Uma palavra secreta de 5 letras do universo EX e sorteada.',
        'Verde = certa no lugar. Amarelo = existe, lugar errado. Cinza = nao existe.',
        'Voce tem 6 tentativas para acertar.'
      ],
      tip: 'Pense em termos como CLIMA, LIDER ou RITMO para comecar bem.'
    },
    {
      id: 'conexo-ex',
      type: 'ex',
      letter: 'C',
      name: 'Conexo EX',
      desc: 'Agrupe as palavras por categoria EX',
      rule: 'Encontre os grupos de palavras conectadas',
      steps: [
        '16 palavras do universo EX aparecem embaralhadas.',
        'Encontre os 4 grupos de 4 palavras com o mesmo tema.',
        'Selecione 4 palavras e confirme. Tentativas sao limitadas.'
      ],
      tip: 'Agrupe pelo sentimento que a palavra evoca: pertencimento, lideranca, bem-estar.'
    },
    {
      id: 'quem-disse-ex',
      type: 'ex',
      letter: 'Q',
      name: 'Quem Disse? EX',
      desc: 'Identifique quem fez a afirmacao interna',
      rule: 'Leia a frase e identifique a origem interna',
      steps: [
        'Uma frase sobre cultura e experiencia do colaborador aparece.',
        'Identifique se veio de colaborador, lider ou RH.',
        'Cada acerto aumenta o score. Erros revelam a resposta correta.'
      ],
      tip: 'Lideres falam de resultado. Colaboradores falam de como se sentem.'
    },
    {
      id: 'sequencia-ex',
      type: 'ex',
      letter: 'S',
      name: 'Sequencia EX',
      desc: 'Monte a ordem do fluxo de EX',
      rule: 'Ordene as etapas da jornada do colaborador',
      steps: [
        'Um cenario de jornada do colaborador e dividido em etapas embaralhadas.',
        'Escolha as etapas na sequencia correta.',
        'Acertar a ordem completa garante XP maximo.'
      ],
      tip: 'A jornada comeca antes da contratacao: pense em atracao e onboarding primeiro.'
    }
  ];

  function canonicalizeGameId(gameId) {
    return GAME_ALIASES[gameId] || gameId;
  }

  function getGameMeta(gameId) {
    const canonicalId = canonicalizeGameId(gameId);
    return INTERMISSION_VISUAL_GAMES.find(game => game.id === canonicalId) || null;
  }

  function getGameTheme(gameId) {
    const meta = getGameMeta(gameId);
    const type = meta?.type || 'cx';
    return {
      type,
      color: CX_COLOR,
      soft: '#FBEAE0',
      border: CX_COLOR
    };
  }

  function buildRouletteSequence(winnerId, loops = 3) {
    const winner = getGameMeta(winnerId) || INTERMISSION_VISUAL_GAMES[0];
    const winnerIndex = INTERMISSION_VISUAL_GAMES.findIndex(game => game.id === winner.id);
    const total = Math.max(1, loops) * INTERMISSION_VISUAL_GAMES.length + winnerIndex;
    const sequence = [];
    for (let i = 0; i <= total; i++) {
      sequence.push(INTERMISSION_VISUAL_GAMES[i % INTERMISSION_VISUAL_GAMES.length]);
    }
    return sequence;
  }

  return {
    CX_COLOR,
    EX_COLOR,
    INTERMISSION_VISUAL_GAMES,
    buildRouletteSequence,
    canonicalizeGameId,
    getGameMeta,
    getGameTheme
  };
});
