function logunModalDebugLog(...args) {
  if (typeof window !== 'undefined' && window.CX_DEBUG === true) {
    console.debug(...args);
  }
}

/**
 * Sentury Modal Integration - Integração com o sistema CX Game
 * 
 * Classe para integrar o LogunModal com desafios de texto do CX Game.
 * Gerencia a validação de respostas abertas usando o Sentury-IA.
 */

class LogunModalIntegration {
  constructor(options = {}) {
    this.options = {
      // Configurações da API
      apiEndpoint: options.apiEndpoint || 'https://api.expconnect.com.br/logun/validate',
      
      // Configurações do modal
      modalOptions: {
        readingDuration: 1600,
        analysisDuration: 4500,
        completionDelay: 900,
        ...options.modalOptions
      },
      
      onValidationComplete: options.onValidationComplete || (() => {}),
      onValidationError: options.onValidationError || (() => {}),
      onRetry: options.onRetry || (() => {}),
      
      // Configurações de desafio
      challengeConfig: {
        criteria: ['empatia', 'clareza', 'tom_profissional', 'proximo_passo'],
        minLength: 50,
        maxLength: 500,
        ...options.challengeConfig
      },
      
      ...options
    };

    this.modal = null;
    this.currentChallenge = null;
    this.validationHistory = [];
    
    this.init();
  }

  init() {
    // Garantir que os estilos estejam carregados ANTES de criar o modal
    this.ensureStyles().then(() => {
      this.modal = new LogunModal({
        ...this.options.modalOptions,
        apiEndpoint: this.options.apiEndpoint,
        onClose: () => this.handleModalClose(),
        onRetry: () => this.handleRetry(),
        onReroll: () => this.handleReroll()
      });
    });
  }

  ensureStyles() {
    return new Promise((resolve) => {
      const existingLink = document.querySelector('#logun-modal-styles');
      
      if (existingLink) {
        // Se já existe, verificar se está carregado
        if (existingLink.sheet) {
          resolve();
        } else {
          existingLink.addEventListener('load', () => resolve());
        }
        return;
      }

      const link = document.createElement('link');
      link.id = 'logun-modal-styles';
      link.rel = 'stylesheet';
      link.href = '/frontend/css/components/logun-modal.css?v=20260517-002';
      
      link.addEventListener('load', () => {
        logunModalDebugLog('[LogunModalIntegration] CSS carregado com sucesso');
        resolve();
      });
      
      link.addEventListener('error', () => {
        console.error('[LogunModalIntegration] Erro ao carregar CSS');
        resolve(); // Resolver mesmo com erro para não travar
      });
      
      document.head.appendChild(link);
    });
  }

  /**
   * Validar resposta de texto usando Sentury-IA
   * @param {string} text - Texto da resposta
   * @param {Object} challengeData - Dados do desafio
   * @returns {Promise<Object>} - Resultado da validação
   */
  async validateTextResponse(text, challengeData = {}) {
    // Validações básicas
    const validation = this.validateInput(text);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Aguardar modal estar pronto
    if (!this.modal) {
      console.warn('[LogunModalIntegration] Modal ainda não está pronto, aguardando...');
      await this.waitForModal();
    }

    this.currentChallenge = {
      id: challengeData.challengeId || 'text-challenge',
      text: text.trim(),
      criteria: challengeData.criteria || this.options.challengeConfig.criteria,
      context: challengeData.context || {},
      timestamp: Date.now()
    };

    try {
      // Abrir modal e iniciar análise
      await this.modal.open(text, this.currentChallenge);
      
      // O modal gerencia a validação internamente
      // Aguardar resultado através dos callbacks
      
    } catch (error) {
      console.error('[LogunModalIntegration] Erro na validação:', error);
      this.options.onValidationError(error);
      throw error;
    }
  }

  /**
   * Aguardar modal estar pronto
   * @returns {Promise<void>}
   */
  waitForModal() {
    return new Promise((resolve) => {
      const checkModal = () => {
        if (this.modal) {
          resolve();
        } else {
          setTimeout(checkModal, 100);
        }
      };
      checkModal();
    });
  }

  /**
   * Validar entrada do usuário
   * @param {string} text - Texto a validar
   * @returns {Object} - Resultado da validação
   */
  validateInput(text) {
    if (!text || typeof text !== 'string') {
      return { valid: false, error: 'Texto é obrigatório' };
    }

    const trimmedText = text.trim();
    
    if (trimmedText.length < this.options.challengeConfig.minLength) {
      return { 
        valid: false, 
        error: `Resposta muito curta. Mínimo ${this.options.challengeConfig.minLength} caracteres.` 
      };
    }

    if (trimmedText.length > this.options.challengeConfig.maxLength) {
      return { 
        valid: false, 
        error: `Resposta muito longa. Máximo ${this.options.challengeConfig.maxLength} caracteres.` 
      };
    }

    // Validações adicionais
    if (this.containsInappropriateContent(trimmedText)) {
      return { valid: false, error: 'Conteúdo inapropriado detectado' };
    }

    return { valid: true };
  }

  /**
   * Verificar conteúdo inapropriado (básico)
   * @param {string} text - Texto a verificar
   * @returns {boolean} - True se contém conteúdo inapropriado
   */
  containsInappropriateContent(text) {
    const inappropriateWords = [
      // Lista básica - expandir conforme necessário
      'spam', 'teste', 'asdf', 'qwerty'
    ];

    const lowerText = text.toLowerCase();
    return inappropriateWords.some(word => lowerText.includes(word));
  }

  /**
   * Integrar com formulário de desafio existente
   * @param {string} formSelector - Seletor do formulário
   * @param {Object} options - Opções de integração
   */
  integrateWithForm(formSelector, options = {}) {
    const form = document.querySelector(formSelector);
    if (!form) {
      console.warn(`[LogunModalIntegration] Formulário não encontrado: ${formSelector}`);
      return;
    }

    const textArea = form.querySelector('textarea, input[type="text"]');
    const submitBtn = form.querySelector('button[type="submit"], .submit-btn');
    
    if (!textArea || !submitBtn) {
      console.warn('[LogunModalIntegration] Elementos do formulário não encontrados');
      return;
    }

    const config = {
      challengeId: options.challengeId || 'form-challenge',
      criteria: options.criteria || this.options.challengeConfig.criteria,
      context: options.context || {},
      preventDefaultSubmit: options.preventDefaultSubmit !== false,
      ...options
    };

    // Interceptar submit do formulário
    form.addEventListener('submit', async (e) => {
      if (config.preventDefaultSubmit) {
        e.preventDefault();
      }

      const text = textArea.value.trim();
      if (!text) {
        this.showError('Por favor, escreva sua resposta antes de enviar.');
        return;
      }

      try {
        // Desabilitar botão durante validação
        submitBtn.disabled = true;
        submitBtn.textContent = 'Enviando...';

        await this.validateTextResponse(text, config);

      } catch (error) {
        this.showError(error.message);
      } finally {
        // Reabilitar botão
        submitBtn.disabled = false;
        submitBtn.textContent = options.submitText || 'Enviar resposta';
      }
    });

    // Contador de caracteres
    if (options.showCharCount !== false) {
      this.addCharacterCounter(textArea, options.maxLength);
    }
  }

  /**
   * Adicionar contador de caracteres
   * @param {number} maxLength - Limite máximo
   */
  addCharacterCounter(textArea, maxLength = null) {
    const max = maxLength || this.options.challengeConfig.maxLength;
    
    const counter = document.createElement('div');
    counter.className = 'logun-char-counter';
    counter.style.cssText = `
      position: absolute;
      right: 12px;
      bottom: 12px;
      font-size: 0.8rem;
      color: #9a9a9a;
      pointer-events: none;
    `;

    // Posicionar container
    const container = textArea.parentElement;
    if (container && getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    container.appendChild(counter);

    const updateCounter = () => {
      const length = textArea.value.length;
      counter.textContent = `${length} / ${max}`;
      
      // Cores baseadas no limite
      if (length >= max * 0.9) {
        counter.style.color = '#ff5c5c'; // Vermelho
      } else if (length >= max * 0.7) {
        counter.style.color = '#ff9d2f'; // Laranja
      } else {
        counter.style.color = '#9a9a9a'; // Cinza
      }
    };

    textArea.addEventListener('input', updateCounter);
    updateCounter();
  }

  /**
   * Mostrar erro para o usuário
   * @param {string} message - Mensagem de erro
   */
  showError(message) {
    // Implementar notificação de erro
    // Pode usar sistema de notificações existente do CX Game
    console.error('[LogunModalIntegration]', message);
    
    // Fallback: alert simples
    alert(message);
  }

  /**
   * Handlers dos eventos do modal
   */
  handleModalClose() {
    // Modal fechado pelo usuário - continuar fluxo normal
    logunModalDebugLog('[LogunModalIntegration] Modal fechado - continuando fluxo');
    
    // Chamar callback de conclusão se houver resultado
    if (this.currentChallenge && this.modal.state.currentResult) {
      this.options.onValidationComplete({
        challenge: this.currentChallenge,
        result: this.modal.state.currentResult,
        action: 'continue_flow'
      });
    }
  }

  handleRetry() {
    // Usuário quer tentar outra resposta (não continuar fluxo)
    logunModalDebugLog('[LogunModalIntegration] Retry solicitado');
    this.options.onRetry(this.currentChallenge);
  }

  handleReroll() {
    // Usuário quer gerar outro parecer para a mesma resposta
    logunModalDebugLog('[LogunModalIntegration] Reroll solicitado');
    
    if (this.currentChallenge) {
      this.validationHistory.push({
        ...this.currentChallenge,
        result: 'reroll_requested'
      });
    }
  }

  /**
   * Obter histórico de validações
   * @returns {Array} - Array com histórico
   */
  getValidationHistory() {
    return [...this.validationHistory];
  }

  /**
   * Limpar histórico de validações
   */
  clearValidationHistory() {
    this.validationHistory = [];
  }

  /**
   * Destruir integração
   */
  destroy() {
    if (this.modal) {
      this.modal.destroy();
      this.modal = null;
    }
    
    this.currentChallenge = null;
    this.validationHistory = [];
  }
}

// Função helper para uso rápido
window.createLogunIntegration = function(options = {}) {
  return new LogunModalIntegration(options);
};

// Exportar para uso global
window.LogunModalIntegration = LogunModalIntegration;
