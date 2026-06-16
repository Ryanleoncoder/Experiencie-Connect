/**
 * Mystery Progress Bar Component
 *
 * Exibe o progresso do usuário com revelação progressiva:
 * - Fases completadas mostram cor e ícone do tipo
 * - Fase atual destacada em amarelo
 * - Fases futuras permanecem misteriosas (cinza neutro)
 *
 * Tipos de fase:
 * - normal: Amarelo #f0c000 (sem ícone)
 * - game: Coral #D85A30 
 * - sentury: Roxo #7c6ff7 🤖
 */

class MysteryProgressBar {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error(`[MysteryProgressBar] Container #${containerId} not found`);
      return;
    }

    this.options = {
      animationDuration: options.animationDuration || 300,
      ...options
    };

    this.phases = [];
    this.init();
  }

  init() {
    this.ensureAnimationStyles();
    this.container.classList.add('mystery-progress-bar');
  }

  ensureAnimationStyles() {
    if (typeof document === 'undefined' || document.getElementById('mystery-progress-bar-animations')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'mystery-progress-bar-animations';
    style.textContent = `
      @keyframes mysteryRevealDot {
        from { transform: scale(0.72); opacity: 0.45; }
        to { transform: scale(1); opacity: 1; }
      }

      @keyframes mysteryRevealIcon {
        from { transform: translateY(4px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }

      @keyframes mysteryRevealConnector {
        from { transform: scaleX(0); }
        to { transform: scaleX(1); }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Atualiza a barra de progresso com novas fases
   * @param {Array} phases - Array de objetos { id, type, done, current }
   */
  update(phases) {
    this.phases = phases;
    this.render();
  }

  /**
   * Renderiza a barra de progresso
   */
  render() {
    this.container.innerHTML = '';

    this.phases.forEach((phase, index) => {
      const col = this.createPhaseColumn(phase, index);
      this.container.appendChild(col);
    });

    // Apply transition styles to all connectors for smooth animations
    const connectors = this.container.querySelectorAll('.mystery-step-connector');
    connectors.forEach(connector => {
      connector.style.transition = 'background 0.4s ease-out, transform 0.4s ease-out';
      connector.style.willChange = 'background, transform';
    });
  }

  /**
   * Cria uma coluna de fase (ícone + dot + conector)
   */
  createPhaseColumn(phase, index) {
    const col = document.createElement('div');
    col.className = 'mystery-step-col';
    col.dataset.phaseId = phase.id;
    col.dataset.phaseType = phase.type;

    // Dot (ícone do evento vai DENTRO do círculo; número p/ etapas normais)
    const dot = document.createElement('div');
    dot.className = 'mystery-step-dot';
    this.applyDotStyle(dot, phase, index);
    col.appendChild(dot);

    // Conector (linha entre dots)
    if (index < this.phases.length - 1) {
      const connector = document.createElement('div');
      connector.className = 'mystery-step-connector';

      const nextPhase = this.phases[index + 1];
      const isConnectorActive = phase.done && nextPhase.done;
      connector.style.background = isConnectorActive ? '#E5A800' : '#DDD8C8';

      col.appendChild(connector);
    }

    return col;
  }

  /**
   * Aplica estilos ao dot baseado no estado da fase
   */
  applyDotStyle(dot, phase, index = null) {
    const color = this.getColor(phase.type);
    const isSpecial = phase.type !== 'normal';
    const revealed = phase.done || phase.current;

    // Conteúdo do círculo: ÍCONE do evento (game/sentury) quando revelado; senão, número da etapa
    dot.innerHTML = '';
    if (isSpecial && revealed) {
      const iconEl = this.getIconElement(phase.type);
      if (iconEl) dot.appendChild(iconEl);
      else if (index !== null) dot.textContent = String(index + 1);
    } else if (index !== null) {
      dot.textContent = String(index + 1);
    }

    if (phase.done) {
      // Etapa já vivida: cor do tipo (amarelo / coral / roxo)
      dot.style.background = isSpecial ? color : '#FFC700';
      dot.style.color = isSpecial ? '#fff' : '#0A0A0A';
      dot.style.borderColor = '#0A0A0A';
      dot.classList.add('mystery-step-dot--done');
    } else if (phase.current) {
      // Etapa atual: cor do tipo + destaque (sombra offset dura)
      dot.style.background = isSpecial ? color : '#FFC700';
      dot.style.color = isSpecial ? '#fff' : '#0A0A0A';
      dot.style.borderColor = '#0A0A0A';
      dot.style.boxShadow = '3px 3px 0 ' + (isSpecial ? color : '#E5A800');
      dot.classList.add('mystery-step-dot--current');
    } else {
      // Etapa futura: ainda não revelada (papel, número apagado)
      dot.style.background = '#fff';
      dot.style.color = '#B5B0A5';
      dot.style.borderColor = '#B5B0A5';
      dot.classList.add('mystery-step-dot--future');
    }
  }

  /**
   * Retorna a cor baseada no tipo de fase
   */
  getColor(type) {
    const colors = {
      normal: '#FFC700',
      game: '#D85A30',
      logum: '#6B4FFF'
    };
    return colors[type] || colors.normal;
  }

  /**
   * Retorna o elemento de ícone baseado no tipo
   */
  getIconElement(type) {
    const svgIcons = {
      game: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 6m0 2a2 2 0 0 1 2 -2h16a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2z"/>
        <path d="M6 12h4m-2 -2v4"/>
        <path d="M15 11l0 .01"/>
        <path d="M18 13l0 .01"/>
      </svg>`,
      logum: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 4m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z"/>
        <path d="M12 2v2"/>
        <path d="M9 12v9"/>
        <path d="M15 12v9"/>
        <path d="M5 16l4 -2"/>
        <path d="M15 14l4 2"/>
        <path d="M9 18h6"/>
        <path d="M10 8v.01"/>
        <path d="M14 8v.01"/>
      </svg>`
    };

    if (!svgIcons[type]) return null;

    const wrapper = document.createElement('span');
    wrapper.innerHTML = svgIcons[type];
    wrapper.setAttribute('aria-hidden', 'true');
    wrapper.classList.add(`mystery-icon-${type}`);
    return wrapper.firstElementChild;
  }

  /**
   * Anima a revelação de uma fase quando completada
   * @param {string} phaseId - ID da fase completada
   */
  revealPhase(phaseId) {
    const phaseIndex = this.phases.findIndex(p => p.id === phaseId);
    if (phaseIndex === -1) return;

    this.phases[phaseIndex].done = true;
    this.phases[phaseIndex].current = false;

    // Move current para próxima fase
    if (phaseIndex + 1 < this.phases.length) {
      this.phases[phaseIndex + 1].current = true;
    }

    const col = this.container.querySelector(`[data-phase-id="${phaseId}"]`);
    if (!col) return;

    const revealedColor = this.getColor(this.phases[phaseIndex].type);
    const revealedSpecial = this.phases[phaseIndex].type !== 'normal';
    const dot = col.querySelector('.mystery-step-dot');
    if (dot) {
      // Apply completed state styling (EC: cor do tipo)
      dot.style.background = revealedSpecial ? revealedColor : '#FFC700';
      dot.style.color = revealedSpecial ? '#fff' : '#0A0A0A';
      dot.style.borderColor = '#0A0A0A';
      dot.classList.remove('mystery-step-dot--current');
      dot.classList.add('mystery-step-dot--done');
      dot.style.animation = 'mysteryRevealDot 0.3s ease-out';
      dot.style.boxShadow = '';
    }

    // Ícone do evento DENTRO do círculo (revelação)
    if (dot && revealedSpecial) {
      const iconElement = this.getIconElement(this.phases[phaseIndex].type);
      if (iconElement) {
        dot.innerHTML = '';
        dot.appendChild(iconElement);
        iconElement.style.animation = 'mysteryRevealIcon 0.3s ease-out 0.1s backwards';
      }
    }

    // Animate the connector if the next phase is also done
    const connector = col.querySelector('.mystery-step-connector');
    if (connector && phaseIndex + 1 < this.phases.length) {
      const nextPhase = this.phases[phaseIndex + 1];
      if (nextPhase.done) {
        // Ensure transition is applied
        connector.style.transition = 'background 0.4s ease-out, transform 0.4s ease-out';
        connector.style.transformOrigin = 'left center';
        connector.style.willChange = 'background, transform';
        connector.style.animation = 'mysteryRevealConnector 0.4s ease-out';
        connector.style.background = '#E5A800';
      }
    }

    if (phaseIndex + 1 < this.phases.length) {
      const nextPhaseId = this.phases[phaseIndex + 1].id;
      const nextCol = this.container.querySelector(`[data-phase-id="${nextPhaseId}"]`);
      if (nextCol) {
        const nextDot = nextCol.querySelector('.mystery-step-dot');
        if (nextDot) {
          // Apply current state styling (EC)
          const nextColor = this.getColor(this.phases[phaseIndex + 1].type);
          const nextSpecial = this.phases[phaseIndex + 1].type !== 'normal';
          nextDot.style.background = nextSpecial ? nextColor : '#FFC700';
          nextDot.style.color = nextSpecial ? '#fff' : '#0A0A0A';
          nextDot.style.borderColor = '#0A0A0A';
          nextDot.style.boxShadow = '3px 3px 0 ' + (nextSpecial ? nextColor : '#E5A800');
          if (nextSpecial) {
            const ic = this.getIconElement(this.phases[phaseIndex + 1].type);
            if (ic) { nextDot.innerHTML = ''; nextDot.appendChild(ic); }
          }
          nextDot.classList.remove('mystery-step-dot--future');
          nextDot.classList.add('mystery-step-dot--current');
        }
      }
    }
  }

  /**
   * Converte manifest do intermission para formato de phases
   * @param {Array} completedChallenges - IDs dos desafios completados
   * @param {string} currentChallengeId - ID do desafio atual
   * @returns {Array} Array de phases
   */
  static fromIntermissionManifest(manifest, completedChallenges = [], currentChallengeId = null, challengeStatusMap = new Map()) {
    if (!manifest || !manifest.nodes) return [];

    const resolveNodeId = (node) => {
      const resolved = typeof window !== 'undefined'
        ? window.IntermissionFlow?.resolveFlowChallengeId?.(node)
        : null;
      if (resolved) return resolved;

      if (node?.flow_challenge_id) return node.flow_challenge_id;
      if (typeof node?.synthetic_challenge_id === 'string') {
        if (node.synthetic_challenge_id.startsWith('ig-')) return node.synthetic_challenge_id;
        const legacyMatch = node.synthetic_challenge_id.match(/^game:L(\d+):slot(\d+):/);
        if (legacyMatch) return `ig-L${legacyMatch[1]}-slot${legacyMatch[2]}`;
      }

      return node?.challenge_id || null;
    };

    const phases = manifest.nodes.map(node => {
      const nodeId = node.type === 'game' ? resolveNodeId(node) : node.challenge_id;
      const isCompleted = typeof window !== 'undefined' && window.IntermissionFlow?.isNodeCompleted
        ? window.IntermissionFlow.isNodeCompleted(node, completedChallenges, challengeStatusMap)
        : (
          completedChallenges.includes(nodeId) ||
          Boolean(
            node?.type === 'challenge' &&
            challengeStatusMap?.get?.(node.challenge_id) &&
            ['completed', 'failed'].includes(challengeStatusMap.get(node.challenge_id).status)
          )
        );

      const isCurrent = node.type === 'challenge'
        ? node.challenge_id === currentChallengeId
        : nodeId === currentChallengeId;

      return {
        id: nodeId,
        type: node.type === 'game' ? 'game' : ((node.challenge_id?.startsWith('txt-') || node.challenge_id?.startsWith('lg-')) ? 'logum' : 'normal'),
        done: isCompleted,
        current: isCurrent
      };
    });

    const currentIndex = phases.findIndex(phase => phase.id === currentChallengeId);
    if (currentIndex >= 0) {
      return phases.map((phase, index) => ({
        ...phase,
        done: phase.done,
        current: index === currentIndex
      }));
    }

    return phases;
  }

  /**
   * Converte desafios locais em phases quando o manifesto da VPS nao carrega.
   */
  static fromChallengeList(challenges = [], completedChallenges = [], currentChallengeId = null, challengeStatusMap = new Map()) {
    if (!Array.isArray(challenges)) return [];

    const phases = challenges
      .filter(challenge => challenge && challenge.id)
      .map(challenge => ({
        id: challenge.id,
        type: (challenge.id?.startsWith('txt-') || challenge.id?.startsWith('lg-')) ? 'logum' : 'normal',
        done: completedChallenges.includes(challenge.id) || Boolean(
          challengeStatusMap?.get?.(challenge.id) &&
          ['completed', 'failed'].includes(challengeStatusMap.get(challenge.id).status)
        ),
        current: challenge.id === currentChallengeId
      }));

    const currentIndex = phases.findIndex(phase => phase.id === currentChallengeId);
    if (currentIndex >= 0) {
      return phases.map((phase, index) => ({
        ...phase,
        done: phase.done,
        current: index === currentIndex
      }));
    }

    return phases;
  }

  /**
   * Destroi o componente
   */
  destroy() {
    if (this.container) {
      this.container.innerHTML = '';
      this.container.classList.remove('mystery-progress-bar');
    }
  }
}

// Exportar para uso global
if (typeof window !== 'undefined') {
  window.MysteryProgressBar = MysteryProgressBar;
}

// Exportar para módulos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MysteryProgressBar;
}
