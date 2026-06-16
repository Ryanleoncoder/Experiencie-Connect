/**
 * TimingConfig.js
 * 
 * Centraliza todas as constantes de timing para o fluxo de revelação do avatar exclusivo.
 * Este arquivo permite ajustar facilmente a experiência de timing sem modificar a lógica
 * de animação em múltiplos arquivos.
 * 
 * Todos os valores estão em milissegundos (ms).
 */

/**
 * Configuração padrão de timing para o fluxo de revelação do avatar exclusivo.
 * Estes valores foram calibrados para criar uma experiência gamificada com suspense
 * e engajamento emocional apropriados.
 */
const DEFAULT_TIMING_CONFIG = {
  // SPLASH SCREEN
  
  /**
   * Duração mínima de exibição do splash screen "Espera ✋🏾 Temos algo especial para você."
   * Este delay cria antecipação e garante que o usuário leia a mensagem.
   */
  splashScreenDuration: 1500,
  
  // BASE AVATAR DISPLAY
  
  /**
   * Delay após o splash screen antes de mostrar o avatar base do usuário.
   * Este delay cria uma pausa natural entre as etapas.
   */
  baseAvatarDelay: 800,
  
  // CONFIRMATION BUTTON
  
  /**
   * Delay após o avatar base aparecer antes de mostrar o botão "Confirmar".
   * Este delay dá tempo para o usuário apreciar seu avatar exclusivo.
   */
  confirmButtonDelay: 800,
  
  
  /**
   * Delay após o usuário clicar em "Confirmar" antes do Sentury aparecer.
   * Este delay cria suspense antes da primeira aparição do personagem.
   */
  logumAppearanceDelay: 400,
  
  // MESSAGE TYPING
  
  /**
   * Velocidade do efeito de digitação (typing effect) nas mensagens do Sentury.
   * Delay entre cada palavra para simular digitação natural.
   */
  messageTypingSpeed: 50,
  
  // GENERATION ANIMATION
  
  /**
   * Duração mínima da animação de "geração" da imagem com óculos.
   * Este delay cria suspense e expectativa para a revelação do cool avatar.
   */
  generationAnimationDuration: 2000,
  
  // COOL AVATAR TRANSITION
  
  /**
   * Duração da transição (cross-fade) do avatar base para o cool avatar.
   * Este delay controla a suavidade da transição visual.
   */
  coolAvatarTransitionDuration: 600,
  
  // CHOICE BUTTONS
  
  /**
   * Delay após o cool avatar aparecer antes de mostrar os botões de escolha.
   * Este delay dá tempo para o usuário ver a versão com óculos antes de decidir.
   */
  choiceButtonsDelay: 800,
  
  // SELECTION FEEDBACK
  
  /**
   * Duração da animação de feedback visual quando o usuário seleciona uma variante.
   * Este delay cria uma resposta visual satisfatória à escolha do usuário.
   */
  selectionFeedbackDuration: 300,
  
  
  /**
   * Delay após a seleção antes de prosseguir para a próxima etapa (criação de senha).
   * Este delay permite que o feedback visual complete antes da transição.
   */
  redirectDelay: 600,
  
  // COOL AVATAR LOADING
  
  /**
   * Timeout máximo para carregar o cool avatar (versão com óculos).
   * Se o carregamento exceder este tempo, o sistema prossegue apenas com o avatar base.
   */
  coolAvatarLoadTimeout: 5000,
  
  // ANIMATION DURATIONS (General)
  
  /**
   * Duração padrão para animações de fade-in.
   * Usado em splash screen, botões e outros elementos que aparecem gradualmente.
   */
  fadeInDuration: 300,
  
  /**
   * Duração padrão para animações de slide-up.
   * Usado no avatar card e botões de escolha para criar movimento vertical.
   */
  slideUpDuration: 500,
};

/**
 * Configuração de timing acelerada para testes e desenvolvimento.
 * Todos os delays são reduzidos para 10% do valor original, permitindo
 * testar o fluxo completo rapidamente sem esperar os delays completos.
 * 
 * IMPORTANTE: Esta configuração NÃO deve ser usada em produção.
 */
const FAST_TIMING_CONFIG = {
  splashScreenDuration: 150,           // 1500ms → 150ms
  baseAvatarDelay: 80,                 // 800ms → 80ms
  confirmButtonDelay: 80,              // 800ms → 80ms
  logumAppearanceDelay: 40,            // 400ms → 40ms
  messageTypingSpeed: 5,               // 50ms → 5ms
  generationAnimationDuration: 200,    // 2000ms → 200ms
  coolAvatarTransitionDuration: 60,    // 600ms → 60ms
  choiceButtonsDelay: 80,              // 800ms → 80ms
  selectionFeedbackDuration: 30,       // 300ms → 30ms
  redirectDelay: 60,                   // 600ms → 60ms
  coolAvatarLoadTimeout: 500,          // 5000ms → 500ms
  fadeInDuration: 30,                  // 300ms → 30ms
  slideUpDuration: 50,                 // 500ms → 50ms
};

/**
 * Configuração de timing para usuários com preferência de movimento reduzido.
 * Respeita a media query prefers-reduced-motion reduzindo durações de animação em 70%.
 * (Requirement 13.5)
 */
const REDUCED_MOTION_TIMING_CONFIG = {
  splashScreenDuration: 450,           // 1500ms → 450ms (70% redução)
  baseAvatarDelay: 240,                // 800ms → 240ms
  confirmButtonDelay: 240,             // 800ms → 240ms
  logumAppearanceDelay: 120,           // 400ms → 120ms
  messageTypingSpeed: 15,              // 50ms → 15ms
  generationAnimationDuration: 0,      // 2000ms → 0ms (pulado completamente)
  coolAvatarTransitionDuration: 180,   // 600ms → 180ms
  choiceButtonsDelay: 240,             // 800ms → 240ms
  selectionFeedbackDuration: 90,       // 300ms → 90ms
  redirectDelay: 180,                  // 600ms → 180ms
  coolAvatarLoadTimeout: 5000,         // Mantém timeout original
  fadeInDuration: 90,                  // 300ms → 90ms
  slideUpDuration: 150,                // 500ms → 150ms
};

/**
 * Retorna a configuração de timing apropriada baseada nas preferências do usuário.
 * 
 * @param {Object} options - Opções de configuração
 * @param {boolean} options.fast - Se true, usa FAST_TIMING_CONFIG para testes
 * @param {boolean} options.respectReducedMotion - Se true, detecta prefers-reduced-motion
 * @returns {Object} Configuração de timing apropriada
 */
function getTimingConfig(options = {}) {
  const { fast = false, respectReducedMotion = true } = options;
  
  // Modo de teste rápido tem prioridade
  if (fast) {
    return { ...FAST_TIMING_CONFIG };
  }
  
  // Detectar preferência de movimento reduzido
  if (respectReducedMotion && window.matchMedia) {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      return { ...REDUCED_MOTION_TIMING_CONFIG };
    }
  }
  
  // Configuração padrão
  return { ...DEFAULT_TIMING_CONFIG };
}

/**
 * Permite sobrescrever valores específicos da configuração de timing.
 * Útil para ajustes finos ou testes de valores específicos.
 * 
 * @param {Object} baseConfig - Configuração base (DEFAULT_TIMING_CONFIG, FAST_TIMING_CONFIG, etc.)
 * @param {Object} overrides - Valores a sobrescrever
 * @returns {Object} Nova configuração com overrides aplicados
 * 
 * @example
 * const customConfig = mergeTimingConfig(DEFAULT_TIMING_CONFIG, {
 *   splashScreenDuration: 2000,  // Aumentar splash para 2s
 *   messageTypingSpeed: 30       // Digitação mais lenta
 * });
 */
function mergeTimingConfig(baseConfig, overrides) {
  return { ...baseConfig, ...overrides };
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_TIMING_CONFIG,
    FAST_TIMING_CONFIG,
    REDUCED_MOTION_TIMING_CONFIG,
    getTimingConfig,
    mergeTimingConfig
  };
}

// Export for browser use
if (typeof window !== 'undefined') {
  window.TimingConfig = {
    DEFAULT_TIMING_CONFIG,
    FAST_TIMING_CONFIG,
    REDUCED_MOTION_TIMING_CONFIG,
    getTimingConfig,
    mergeTimingConfig
  };
}
