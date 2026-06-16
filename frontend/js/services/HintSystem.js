/**
 * HintSystem - Gerencia dicas para jogos de intermissão
 * 
 * Fornece lógica de dicas para todos os 4 tipos de jogos de intermissão:
 * - Sequencia CX: Retorna próximo passo correto na sequência
 * - Termo CX: Revela uma letra na posição correta
 * - Conexo CX: Revela uma palavra do grupo incompleto
 * - Quem Disse: Elimina uma opção errada
 * 
 * Custos de dicas:
 * - 1ª dica: GRATUITA (0 XP)
 * - 2ª dica: 10 XP
 * - 3ª dica: 20 XP
 * 
 * Requisitos: FR3.1, FR3.2, FR3.3, FR3.4, FR3.5
 */
(function initHintSystem(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.HintSystem = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function buildHintSystem() {
  
  /**
   * Classe HintSystem
   * Gerencia estado de dicas e fornece lógica de dicas específica do jogo
   */
  class HintSystem {
    constructor(gameType, userXP = 0) {
      this.gameType = gameType;
      this.userXP = userXP;
      this.maxHints = 3;
      this.hintsUsed = 0;
      this.hintCosts = [0, 10, 20]; // 1ª gratuita, 2ª 10 XP, 3ª 20 XP
      this.hintHistory = [];
    }

    getNextHintCost() {
      if (this.hintsUsed >= this.maxHints) {
        return null; // Sem mais dicas disponíveis
      }
      return this.hintCosts[this.hintsUsed];
    }

    canAffordHint() {
      const cost = this.getNextHintCost();
      if (cost === null) return false;
      return this.userXP >= cost;
    }

    hasHintsAvailable() {
      return this.hintsUsed < this.maxHints;
    }

    getHintStatus() {
      const cost = this.getNextHintCost();
      const canAfford = this.canAffordHint();
      const hasAvailable = this.hasHintsAvailable();

      return {
        hintsUsed: this.hintsUsed,
        maxHints: this.maxHints,
        hintsRemaining: this.maxHints - this.hintsUsed,
        nextCost: cost,
        canAfford,
        hasAvailable,
        isDisabled: !hasAvailable || !canAfford,
        disabledReason: !hasAvailable
          ? null
          : !canAfford 
            ? 'XP insuficiente' 
            : null
      };
    }

    useHint(gameState) {
      if (!this.hasHintsAvailable()) {
        return {
          success: false,
          error: null,
          hint: null
        };
      }

      const cost = this.getNextHintCost();
      if (!this.canAffordHint()) {
        return {
          success: false,
          error: 'XP insuficiente',
          hint: null,
          requiredXP: cost,
          currentXP: this.userXP
        };
      }

      this.userXP -= cost;
      this.hintsUsed++;

      const hint = this.generateHint(gameState);
      
      this.hintHistory.push({
        hintNumber: this.hintsUsed,
        cost,
        hint,
        timestamp: Date.now()
      });

      return {
        success: true,
        hint,
        cost,
        remainingXP: this.userXP,
        hintsUsed: this.hintsUsed,
        hintsRemaining: this.maxHints - this.hintsUsed
      };
    }

    generateHint(gameState) {
      switch (this.gameType) {
        case 'sequencia-cx':
        case 'sequencia-ex':
          return this.generateSequenciaHint(gameState);
        
        case 'termo-cx':
        case 'termo-ex':
          return this.generateTermoHint(gameState);
        
        case 'conexo-cx':
        case 'conexo-ex':
          return this.generateConexoHint(gameState);
        
        case 'quem-disse-cx':
        case 'quem-disse-ex':
          return this.generateQuemDisseHint(gameState);
        
        default:
          return {
            type: 'generic',
            message: 'Dica não disponível para este jogo'
          };
      }
    }

    generateSequenciaHint(gameState) {
      const { correctSequence } = gameState;
      
      if (!correctSequence || !Array.isArray(correctSequence)) {
        return {
          type: 'sequencia',
          message: 'Não foi possível gerar dica'
        };
      }

      const order = Array.isArray(gameState.userOrder)
        ? gameState.userOrder
        : Array.isArray(gameState.currentOrder)
          ? gameState.currentOrder
          : [];
      const stepKey = step => {
        if (step && typeof step === 'object') {
          return step.id || step.stepId || step.value || step.text || '';
        }
        return step;
      };
      let nextIndex = 0;
      while (nextIndex < correctSequence.length) {
        const expectedKey = stepKey(correctSequence[nextIndex]);
        const placedKey = stepKey(order[nextIndex]);
        if (!placedKey || placedKey !== expectedKey) {
          break;
        }
        nextIndex++;
      }
      
      if (nextIndex >= correctSequence.length) {
        return {
          type: 'sequencia',
          message: 'A ordem ja esta preenchida',
          complete: true
        };
      }

      const nextStep = correctSequence[nextIndex];

      return {
        type: 'sequencia',
        message: `A próxima etapa correta é: "${nextStep.text || nextStep}"`,
        stepId: nextStep.id || nextStep,
        stepText: nextStep.text || nextStep,
        position: nextIndex + 1
      };
    }

    generateTermoHint(gameState) {
      const { targetWord, guesses, revealedPositions } = gameState;
      
      if (!targetWord || typeof targetWord !== 'string') {
        return {
          type: 'termo',
          message: 'Não foi possível gerar dica'
        };
      }

      const revealed = revealedPositions || [];
      const availablePositions = [];
      
      for (let i = 0; i < targetWord.length; i++) {
        if (!revealed.includes(i)) {
          availablePositions.push(i);
        }
      }

      if (availablePositions.length === 0) {
        return {
          type: 'termo',
          message: 'Todas as letras já foram reveladas'
        };
      }

      const randomIndex = Math.floor(Math.random() * availablePositions.length);
      const position = availablePositions[randomIndex];
      const letter = targetWord[position];

      return {
        type: 'termo',
        message: `A letra na posição ${position + 1} é: ${letter}`,
        letter,
        position,
        positionDisplay: position + 1
      };
    }

    generateConexoHint(gameState) {
      const { categories, solvedGroups, remaining } = gameState;
      
      if (!categories || !Array.isArray(categories)) {
        return {
          type: 'conexo',
          message: 'Não foi possível gerar dica'
        };
      }

      // Find unsolved categories
      const solvedCategoryIds = (solvedGroups || []).map(g => g.id || g.label);
      const unsolvedCategories = categories.filter(cat => 
        !solvedCategoryIds.includes(cat.id) && !solvedCategoryIds.includes(cat.label)
      );

      if (unsolvedCategories.length === 0) {
        return {
          type: 'conexo',
          message: 'Todos os grupos já foram encontrados'
        };
      }

      const targetCategory = unsolvedCategories[0];
      const remainingWords = remaining || [];
      const categoryWords = targetCategory.words.filter(word => 
        remainingWords.includes(word)
      );

      if (categoryWords.length === 0) {
        return {
          type: 'conexo',
          message: 'Não há palavras disponíveis para revelar'
        };
      }

      const randomIndex = Math.floor(Math.random() * categoryWords.length);
      const word = categoryWords[randomIndex];

      return {
        type: 'conexo',
        message: `A palavra "${word}" pertence ao grupo: ${targetCategory.label || targetCategory.name}`,
        word,
        category: targetCategory.label || targetCategory.name,
        categoryId: targetCategory.id
      };
    }

    generateQuemDisseHint(gameState) {
      const { currentQuestion, eliminatedOptions } = gameState;
      
      if (!currentQuestion || !currentQuestion.correct) {
        return {
          type: 'quem-disse',
          message: 'Não foi possível gerar dica'
        };
      }

      const { correct, options } = currentQuestion;
      const eliminated = eliminatedOptions || [];
      
      const wrongOptions = (options || Object.keys(currentQuestion.profiles || {}))
        .filter(opt => opt !== correct && !eliminated.includes(opt));

      if (wrongOptions.length === 0) {
        return {
          type: 'quem-disse',
          message: 'Não há mais opções para eliminar'
        };
      }

      const randomIndex = Math.floor(Math.random() * wrongOptions.length);
      const eliminatedOption = wrongOptions[randomIndex];

      return {
        type: 'quem-disse',
        message: `A opção "${eliminatedOption}" está incorreta`,
        eliminatedOption,
        remainingOptions: wrongOptions.length - 1
      };
    }

    getHintPenalty() {
      return this.hintsUsed * 0.1; // 10% penalty per hint
    }

    getHintSummary() {
      return {
        hintsUsed: this.hintsUsed,
        maxHints: this.maxHints,
        totalCost: this.hintHistory.reduce((sum, h) => sum + h.cost, 0),
        penalty: this.getHintPenalty(),
        history: this.hintHistory
      };
    }

    updateUserXP(newXP) {
      this.userXP = newXP;
    }
  }

  return HintSystem;
});
