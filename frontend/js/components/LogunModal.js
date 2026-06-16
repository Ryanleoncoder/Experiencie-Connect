/**
 * Sentury Modal Component - Extracted from the legacy Sentury preview
 * 
 * Modal de feedback/análise do Sentury-IA para validação de desafios de texto.
 * Mantém a experiência visual original, mas adaptado ao design system do CX Game.
 * 
 * Funcionalidades:
 * - Abrir ao receber uma resposta
 * - Mostrar estado de análise (loading animado)
 * - Trocar para estado de resultado
 * - Permitir fechar e refazer tentativa
 * - Simular "pensamento" da IA com animações
 */

class LogunModal {
  constructor(options = {}) {
    this.options = {
      // Durações das animações (em ms)
      readingDuration: options.readingDuration || 1600,
      analysisDuration: options.analysisDuration || 4500,
      completionDelay: options.completionDelay || 900,
      
      onClose: options.onClose || (() => {}),
      onRetry: options.onRetry || (() => {}),
      onReroll: options.onReroll || (() => {}),
      
      // Configurações
      apiEndpoint: options.apiEndpoint || '/api/logun/validate',
      ...options
    };

    this.state = {
      isVisible: false,
      isAnalyzing: false,
      currentPanel: 'analysis', // 'analysis' | 'result'
      lastSubmittedText: '',
      currentResult: null
    };

    this.timers = {
      reading: null,
      analysis: null,
      completion: null
    };

    this.animations = {
      gazeIndex: 0,
      messageIndex: 0,
      pauseMessageRotation: false,
      isReadingState: false,
      readingGazePhase: 0
    };

    this.init();
  }

  init() {
    this.createModal();
    this.setupEventListeners();
    this.startAnimations();
  }

  createModal() {
    const modalHTML = `
      <div class="logun-overlay" id="logun-overlay" aria-hidden="true" style="display: none;">
        <div class="logun-card">
          <!-- Removido botão X - usuário deve clicar em "Continuar" ou "Gerar outro parecer" -->
          
          <!-- Painel de Análise -->
          <section class="logun-panel logun-panel--analysis is-visible" id="analysis-panel" aria-live="polite">
            <div class="logun-loader">
              <div class="logun-face" aria-hidden="true">
                <div class="logun-bar" id="logun-bL"></div>
                <div class="logun-bar" id="logun-bR"></div>
              </div>

              <div class="logun-status">
                <div class="logun-kicker" id="logun-kicker">
                  <span class="logun-pulse"></span>
                  <span id="logun-kicker-text">Sentury em análise</span>
                </div>
                <div class="logun-status-window">
                  <div class="logun-messages-track" id="logun-track"></div>
                </div>
                <span class="logun-cursor" id="logun-cursor"></span>
                <p class="logun-status-caption" id="logun-status-caption">
                  Analisando contexto, clareza, tom e próximo passo.
                </p>
              </div>
            </div>

            <div class="logun-analysis-answer">
              <div class="logun-analysis-answer__label">Resposta em avaliação</div>
              <p class="logun-analysis-answer__text" id="logun-analysis-text"></p>
            </div>
          </section>

          <!-- Painel de Resultado -->
          <section class="logun-panel logun-panel--result" id="result-panel" aria-live="polite">
            <div class="logun-result-hero">
              <div class="logun-result-badge" id="logun-result-badge">TRUE</div>
              <div class="logun-result-hero__copy">
                <h3 class="logun-result-title" id="logun-result-title">Resposta aprovada</h3>
                <p class="logun-result-text" id="logun-result-text"></p>
              </div>
              <div class="logun-result-face" aria-hidden="true">
                <div class="logun-result-face__bar"></div>
                <div class="logun-result-face__bar"></div>
              </div>
            </div>

            <div class="logun-result-criteria" id="logun-result-criteria">
              <div class="logun-result-criteria-chip" id="logun-rc-0">Empatia</div>
              <div class="logun-result-criteria-chip" id="logun-rc-1">Clareza</div>
              <div class="logun-result-criteria-chip" id="logun-rc-2">Tom profissional</div>
              <div class="logun-result-criteria-chip" id="logun-rc-3">Próximo passo</div>
            </div>

            <div class="logun-result-opinion">
              <div class="logun-result-opinion__label">O que o Sentury achou</div>
              <p class="logun-result-opinion__text" id="logun-result-opinion"></p>
            </div>

            <div class="logun-result-confidence">
              <span class="logun-result-confidence__percent" id="logun-confidence-percent">82%</span>
              <div class="logun-result-confidence__track" aria-hidden="true">
                <div class="logun-result-confidence__fill" id="logun-confidence-fill"></div>
              </div>
              <span class="logun-result-confidence__label">confiança do Sentury</span>
            </div>

          </section>

          <footer class="logun-seal">
            <div class="logun-seal__badge">
              <span class="logun-seal__dot">!</span>
              Sentury desenvolvido por Ryan Cruz
            </div>
            <div class="logun-seal__actions">
              <button class="logun-btn logun-btn--secondary" id="logun-btn-reroll" type="button">
                Gerar outro parecer
              </button>
              <button class="logun-btn logun-btn--primary" id="logun-btn-continue" type="button">
                Continuar desafio
              </button>
            </div>
          </footer>
        </div>
      </div>
    `;

    // Inserir no DOM
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Cachear elementos
    this.elements = {
      overlay: document.getElementById('logun-overlay'),
      analysisPanel: document.getElementById('analysis-panel'),
      resultPanel: document.getElementById('result-panel'),
      
      // Análise
      kicker: document.getElementById('logun-kicker'),
      kickerText: document.getElementById('logun-kicker-text'),
      statusCaption: document.getElementById('logun-status-caption'),
      cursor: document.getElementById('logun-cursor'),
      track: document.getElementById('logun-track'),
      analysisText: document.getElementById('logun-analysis-text'),
      bL: document.getElementById('logun-bL'),
      bR: document.getElementById('logun-bR'),
      
      // Resultado
      resultBadge: document.getElementById('logun-result-badge'),
      resultTitle: document.getElementById('logun-result-title'),
      resultText: document.getElementById('logun-result-text'),
      resultOpinion: document.getElementById('logun-result-opinion'),
      confidencePercent: document.getElementById('logun-confidence-percent'),
      confidenceFill: document.getElementById('logun-confidence-fill'),
      
      // Ações
      btnReroll: document.getElementById('logun-btn-reroll'),
      btnContinue: document.getElementById('logun-btn-continue')
    };
  }

  setupEventListeners() {
    // Ações do resultado
    this.elements.btnContinue?.addEventListener('click', () => this.close());
    this.elements.btnReroll?.addEventListener('click', () => this.reroll());

    // Mouse tracking para o rosto do resultado
    this.elements.overlay.addEventListener('mousemove', (e) => this.trackMouse(e));
    this.elements.overlay.addEventListener('mouseleave', () => this.resetResultGaze());
  }

  // Mensagens de análise
  getMessages() {
    return {
      reading: [
        "Lendo sua resposta<span class='logun-dots'></span>",
        "Processando o contexto<span class='logun-dots'></span>",
        "Absorvendo cada palavra<span class='logun-dots'></span>",
        "Varrendo linha por linha<span class='logun-dots'></span>",
        "Captando o tom da resposta<span class='logun-dots'></span>"
      ],
      
      analysis: [
        "Pensando<span class='logun-dots'></span>",
        "Pensando profundamente<span class='logun-dots'></span>",
        "Achei uma pedra nos algoritmos<span class='logun-dots'></span>",
        "Consultando o oráculo de terça-feira<span class='logun-dots'></span>",
        "Reorganizando os neurônios<span class='logun-dots'></span>",
        "Perdido no contexto, volta já<span class='logun-dots'></span>",
        "Calibrando o gênio interno<span class='logun-dots'></span>",
        "Contando até 3 para não errar<span class='logun-dots'></span>",
        "Destilando sabedoria duvidosa<span class='logun-dots'></span>",
        "Fazendo as contas no dedo<span class='logun-dots'></span>",
        "Invocando Stack Overflow<span class='logun-dots'></span>",
        "Quase lá, prometo<span class='logun-dots'></span>",
        "Conferindo se não estou sonhando<span class='logun-dots'></span>",
        "Lendo entrelinhas invisíveis<span class='logun-dots'></span>",
        "Desemaranhando o raciocínio<span class='logun-dots'></span>",
        "Bebendo café virtual<span class='logun-dots'></span>",
        "Procurando o botão de responder<span class='logun-dots'></span>",
        "Hmm, interessante<span class='logun-dots'></span>",
        "Fingindo que sei a resposta<span class='logun-dots'></span>",
        "Consultando meu eu do futuro<span class='logun-dots'></span>",
        "Compilando criatividade<span class='logun-dots'></span>",
        "Achei! Ops, não era isso<span class='logun-dots'></span>",
        "Verificando se o WiFi está ligado<span class='logun-dots'></span>",
        "Filosofando desnecessariamente<span class='logun-dots'></span>",
        "Montando a resposta tijolo por tijolo<span class='logun-dots'></span>",
        "Renegociando com os bits<span class='logun-dots'></span>",
        "Tentando parecer inteligente<span class='logun-dots'></span>",
        "Checando se não deletei nada importante<span class='logun-dots'></span>",
        "Perguntando pro meu terapeuta digital<span class='logun-dots'></span>",
        "Atualizando o ego em segundo plano<span class='logun-dots'></span>",
        "Farmando aura<span class='logun-dots'></span>"
      ],
      
      completion: [
        "Pensamento concluído",
        "Parecer pronto", 
        "Análise encerrada",
        "Veredito preparado",
        "Resposta consolidada"
      ]
    };
  }

  // Padrões de olhar para animação
  getGazePatterns() {
    return {
      normal: [
        { x: 0, y: 0 },
        { x: 0, y: -12 },
        { x: 0, y: 12 },
        { x: -6, y: 12 },
        { x: 6, y: 12 },
        { x: -8, y: 0 },
        { x: 8, y: 0 },
        { x: -8, y: -10 },
        { x: 8, y: -10 },
        { x: 0, y: 0 }
      ],
      
      reading: [
        { x: -8, y: 12 },
        { x: 8, y: 12 },
        { x: -6, y: 12 },
        { x: 6, y: 12 }
      ]
    };
  }

  // Abrir modal e iniciar análise
  async open(text, challengeData = {}) {
    if (!text || !text.trim()) {
      console.warn('[LogunModal] Texto vazio fornecido');
      return;
    }

    this.state.lastSubmittedText = text.trim();
    this.state.isVisible = true;
    this.state.isAnalyzing = true;

    // Desabilitar botão de continuar durante análise
    if (this.elements.btnContinue) {
      this.elements.btnContinue.disabled = true;
    }

    this.elements.analysisText.textContent = this.state.lastSubmittedText;

    // Mostrar painel de análise ANTES de tornar visível
    this.showAnalysisPanel();

    // Forçar reflow para garantir que os estilos sejam aplicados
    void this.elements.overlay.offsetHeight;

    // Mostrar modal COM DELAY para garantir que CSS está carregado
    requestAnimationFrame(() => {
      // Remove display:none to show the modal
      this.elements.overlay.style.display = '';
      this.elements.overlay.classList.add('is-visible');
      this.elements.overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('logun-modal-open');
    });

    await this.startAnalysisSequence(challengeData);
  }

  async startAnalysisSequence(challengeData) {
    try {
      // 1. Estado de leitura
      this.showReadingState();
      
      await this.delay(this.options.readingDuration);
      
      // 2. Estado de análise
      this.showAnalysisState();
      
      // 3. Fazer chamada para API do Sentury-IA
      const result = await this.callLogunAPI(this.state.lastSubmittedText, challengeData);
      
      await this.delay(this.options.analysisDuration);
      
      // 4. Estado de conclusão
      this.showCompletionState();
      
      await this.delay(this.options.completionDelay);
      
      this.showResult(result);
      
    } catch (error) {
      console.error('[LogunModal] Erro na análise:', error);
      this.showError(error);
    }
  }

  async callLogunAPI(text, challengeData) {
    try {
      const response = await fetch(this.options.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jwt_token')}`
        },
        body: JSON.stringify({
          text: text,
          challenge_id: challengeData.challengeId,
          challenge_type: 'text',
          criteria: challengeData.criteria || ['empatia', 'clareza', 'tom_profissional', 'proximo_passo'],
          context: challengeData.context || {}
        })
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      return await response.json();
      
    } catch (error) {
      console.error('[LogunModal] Erro na API:', error);
      
      // Fallback para resultado fake em caso de erro
      return this.generateFakeResult();
    }
  }

  generateFakeResult() {
    const fakeResults = [
      {
        approved: true,
        criteria: [true, true, true, true],
        title: "Resposta aprovada",
        message: "Sua resposta transmite calma, mostra ownership e encaminha o cliente para um próximo passo de forma segura.",
        opinion: "O tom ficou humano sem perder firmeza. A resposta passa confiança e mostra que o atendimento está no controle.",
        confidence: 87
      },
      {
        approved: false,
        criteria: [true, false, true, false],
        title: "Vamos revisar melhor",
        message: "A intenção está boa, mas a resposta ainda pode ser mais clara sobre o que você vai fazer em seguida para resolver o caso.",
        opinion: "Faltou um fechamento mais objetivo. O cliente entende a empatia, mas ainda pode sair sem saber qual é o próximo passo.",
        confidence: 61
      }
    ];

    return fakeResults[Math.floor(Math.random() * fakeResults.length)];
  }

  showReadingState() {
    this.animations.isReadingState = true;
    this.animations.readingGazePhase = 0;
    this.animations.pauseMessageRotation = false;
    
    // Manter botão desabilitado durante leitura
    if (this.elements.btnContinue) {
      this.elements.btnContinue.disabled = true;
    }
    
    this.elements.kicker.classList.remove('is-complete');
    this.elements.kickerText.textContent = 'Sentury lendo';
    this.elements.statusCaption.textContent = 'Lendo linha por linha, captando tom e contexto.';
    this.elements.cursor.classList.remove('is-hidden');
    
    this.renderTrackMessages(this.getMessages().reading);
  }

  showAnalysisState() {
    this.animations.isReadingState = false;
    this.animations.pauseMessageRotation = false;
    
    // Manter botão desabilitado durante análise
    if (this.elements.btnContinue) {
      this.elements.btnContinue.disabled = true;
    }
    
    this.elements.kicker.classList.remove('is-complete');
    this.elements.kickerText.textContent = 'Sentury em análise';
    this.elements.statusCaption.textContent = 'Analisando contexto, clareza, tom e próximo passo.';
    this.elements.cursor.classList.remove('is-hidden');
    
    const shuffledMessages = this.shuffleArray([...this.getMessages().analysis]);
    this.renderTrackMessages(shuffledMessages);
  }

  showCompletionState() {
    const completionMessages = this.getMessages().completion;
    const randomMessage = completionMessages[Math.floor(Math.random() * completionMessages.length)];
    
    // Manter botão desabilitado durante conclusão
    if (this.elements.btnContinue) {
      this.elements.btnContinue.disabled = true;
    }
    
    this.animations.pauseMessageRotation = true;
    this.elements.kicker.classList.add('is-complete');
    this.elements.kickerText.innerHTML = randomMessage;
    this.elements.statusCaption.textContent = 'O Sentury terminou de pensar e está preparando o parecer.';
    this.elements.cursor.classList.add('is-hidden');
    
    this.renderTrackMessages([randomMessage]);
  }

  showResult(result) {
    this.state.currentResult = result;
    this.state.isAnalyzing = false;
    
    // Habilitar botão de continuar quando resultado estiver pronto
    if (this.elements.btnContinue) {
      this.elements.btnContinue.disabled = false;
    }
    
    this.elements.resultTitle.textContent = result.title;
    this.elements.resultText.textContent = result.message;
    this.elements.resultOpinion.textContent = result.opinion;
    
    // Badge e face
    this.elements.resultBadge.textContent = result.approved ? 'TRUE' : 'FALSE';
    this.elements.resultBadge.classList.toggle('is-approved', result.approved);
    this.elements.resultBadge.classList.toggle('is-revise', !result.approved);
    
    const resultFace = document.querySelector('.logun-result-face');
    resultFace.classList.toggle('is-approved', result.approved);
    resultFace.classList.toggle('is-revise', !result.approved);
    
    // Confiança
    this.elements.confidencePercent.textContent = `${result.confidence}%`;
    this.elements.confidenceFill.style.width = `${result.confidence}%`;
    
    // Critérios
    const criteriaChips = document.querySelectorAll('.logun-result-criteria-chip');
    criteriaChips.forEach((chip, i) => {
      const passed = result.criteria[i];
      chip.classList.toggle('is-ok', passed);
      chip.classList.toggle('is-fail', !passed);
    });
    
    this.showResultPanel();
  }

  showError(error) {
    this.state.isAnalyzing = false;
    
    const errorResult = {
      approved: false,
      criteria: [false, false, false, false],
      title: "Erro na análise",
      message: "Ocorreu um erro durante a análise. Tente novamente em alguns instantes.",
      opinion: "O sistema está temporariamente indisponível. Sua resposta será analisada assim que possível.",
      confidence: 0
    };
    
    this.showResult(errorResult);
  }

  showAnalysisPanel() {
    this.elements.analysisPanel.classList.add('is-visible');
    this.elements.resultPanel.classList.remove('is-visible');
    this.state.currentPanel = 'analysis';
  }

  showResultPanel() {
    this.elements.analysisPanel.classList.remove('is-visible');
    this.elements.resultPanel.classList.add('is-visible');
    this.state.currentPanel = 'result';
  }

  renderTrackMessages(messages) {
    this.elements.track.innerHTML = '';
    messages.forEach((message) => {
      const line = document.createElement('div');
      line.className = 'logun-msg';
      line.innerHTML = message;
      this.elements.track.appendChild(line);
    });
    this.animations.messageIndex = 0;
    this.elements.track.style.transform = 'translateY(0)';
  }

  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // Animações
  startAnimations() {
    // Animação do olhar
    this._gazeInterval = setInterval(() => this.nextGaze(), 440);

    // Rotação de mensagens
    this._msgInterval = setInterval(() => this.nextMessage(), 2400);
    
    // Piscar
    this.doBlink();
  }

  nextGaze() {
    const gazes = this.getGazePatterns();
    
    if (this.animations.isReadingState) {
      this.animations.readingGazePhase = (this.animations.readingGazePhase + 1) % 4;
      const { x, y } = gazes.reading[this.animations.readingGazePhase];
      const transform = `translate(${x}px, ${y}px)`;
      this.elements.bL.style.transform = transform;
      this.elements.bR.style.transform = transform;
      return;
    }
    
    this.animations.gazeIndex = (this.animations.gazeIndex + 1) % gazes.normal.length;
    const { x, y } = gazes.normal[this.animations.gazeIndex];
    const transform = `translate(${x}px, ${y}px)`;
    this.elements.bL.style.transform = transform;
    this.elements.bR.style.transform = transform;
  }

  nextMessage() {
    if (this.animations.pauseMessageRotation) return;
    
    const messages = this.elements.track.children;
    if (messages.length === 0) return;
    
    this.animations.messageIndex = (this.animations.messageIndex + 1) % messages.length;
    this.elements.track.style.transform = `translateY(-${this.animations.messageIndex * 26}px)`;
  }

  doBlink() {
    this.elements.bL.classList.add('blink');
    this.elements.bR.classList.add('blink');
    
    setTimeout(() => {
      this.elements.bL.classList.remove('blink');
      this.elements.bR.classList.remove('blink');
    }, 130);
    
    setTimeout(() => this.doBlink(), 1800 + Math.random() * 2200);
  }

  trackMouse(e) {
    if (this.state.currentPanel !== 'result') return;
    
    const resultFace = document.querySelector('.logun-result-face');
    const resultFaceBars = resultFace.querySelectorAll('.logun-result-face__bar');
    
    const rect = resultFace.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const scale = Math.min(dist, 60) / 60;
    const maxGaze = 5;
    const ox = (dx / dist) * maxGaze * scale;
    const oy = (dy / dist) * maxGaze * scale;
    const transform = `translate(${ox.toFixed(1)}px, ${oy.toFixed(1)}px)`;
    
    resultFaceBars.forEach(bar => {
      bar.style.transform = transform;
    });
  }

  resetResultGaze() {
    const resultFaceBars = document.querySelectorAll('.logun-result-face__bar');
    resultFaceBars.forEach(bar => {
      bar.style.transform = 'translate(0,0)';
    });
  }

  // Métodos públicos
  close() {
    this.clearTimers();
    
    this.state.isVisible = false;
    this.state.isAnalyzing = false;
    
    this.elements.overlay.classList.remove('is-visible');
    this.elements.overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('logun-modal-open');
    
    this.options.onClose();
  }

  continueFlow() {
    // Alias para close() - mesmo comportamento
    this.close();
  }

  async reroll() {
    if (!this.state.lastSubmittedText) return;
    
    // Desabilitar botão durante nova análise
    if (this.elements.btnContinue) {
      this.elements.btnContinue.disabled = true;
    }
    
    this.state.isAnalyzing = true;
    this.showAnalysisPanel();
    
    await this.startAnalysisSequence({});
    
    this.options.onReroll();
  }

  clearTimers() {
    Object.values(this.timers).forEach(timer => {
      if (timer) clearTimeout(timer);
    });
    this.timers = { reading: null, analysis: null, completion: null };
    clearInterval(this._gazeInterval);
    clearInterval(this._msgInterval);
    this._gazeInterval = null;
    this._msgInterval = null;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Destruir modal
  destroy() {
    this.clearTimers();
    
    if (this.elements.overlay) {
      this.elements.overlay.remove();
    }
    
    document.body.classList.remove('logun-modal-open');
  }
}

// Exportar para uso global
window.LogunModal = LogunModal;
