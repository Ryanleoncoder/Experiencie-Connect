/**
 * State machine that orchestrates the exclusive avatar reveal flow.
 * IDLE → SPLASH_SCREEN → BASE_AVATAR_DISPLAY → CONFIRMATION_PENDING →
 * LOGUM_APPEARANCE → GENERATION_ANIMATION → COOL_AVATAR_DISPLAY →
 * CHOICE_PENDING → COMPLETED
 *
 * ExclusivePersonaSystem handles visual rendering.
 * LogumAnimationController handles character animations.
 * TimingConfig centralises all delays.
 */

const FlowState = {
  IDLE: 'IDLE',
  SPLASH_SCREEN: 'SPLASH_SCREEN',
  BASE_AVATAR_DISPLAY: 'BASE_AVATAR_DISPLAY',
  CONFIRMATION_PENDING: 'CONFIRMATION_PENDING',
  LOGUM_APPEARANCE: 'LOGUM_APPEARANCE',
  GENERATION_ANIMATION: 'GENERATION_ANIMATION',
  COOL_AVATAR_DISPLAY: 'COOL_AVATAR_DISPLAY',
  CHOICE_PENDING: 'CHOICE_PENDING',
  COMPLETED: 'COMPLETED'
};

class ExclusiveAvatarRevealFlow {
  constructor(personaSystem, logumController, config = {}) {
    if (!personaSystem) {
      throw new Error('[RevealFlow] personaSystem is required');
    }
    if (!logumController) {
      throw new Error('[RevealFlow] logumController is required');
    }

    this.personaSystem = personaSystem;
    this.logumController = logumController;
    this.config = config;
    this.currentState = FlowState.IDLE;
    this.stateHistory = [];
    this.eventListeners = new Map();
    this.flowStartTime = null;
    this.baseAvatarUrl = null;
    this.coolAvatarUrl = null;
    this.coolAvatarLoaded = false;
    this.selectedVariant = null;
    this.overlayElement = null;
    this.confirmButtonElement = null;

    // Debug panel activated via ?debug=reveal in URL
    this.debugMode = this._detectDebugMode();
    this.debugPanel = null;

    if (this.debugMode) {
      this._debugLog('[RevealFlow] Debug mode ENABLED');
      this._createDebugPanel();
    }

    this._debugLog('[RevealFlow] Initialized in IDLE state');
  }

  _detectDebugMode() {
    if (typeof window === 'undefined' || !window.location) {
      return false;
    }

    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('debug') === 'reveal';
  }

  _debugLog(...args) {
    if (this.debugMode) {
      console.debug(...args);
    }
  }

  _createDebugPanel() {
    this.debugPanel = document.createElement('div');
    this.debugPanel.id = 'reveal-flow-debug-panel';
    this.debugPanel.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      width: 300px;
      max-height: 80vh;
      overflow-y: auto;
      background: rgba(0, 0, 0, 0.9);
      color: #0f0;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      padding: 12px;
      border: 2px solid #0f0;
      border-radius: 4px;
      z-index: 99999;
      box-shadow: 0 4px 12px rgba(0, 255, 0, 0.3);
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      font-weight: bold;
      font-size: 13px;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid #0f0;
    `;
    header.textContent = '🐛 REVEAL FLOW DEBUG';

    const content = document.createElement('div');
    content.id = 'debug-panel-content';

    this.debugPanel.appendChild(header);
    this.debugPanel.appendChild(content);

    document.body.appendChild(this.debugPanel);

    this._updateDebugPanel();
  }

  _updateDebugPanel() {
    if (!this.debugMode || !this.debugPanel) {
      return;
    }

    const content = this.debugPanel.querySelector('#debug-panel-content');
    if (!content) {
      return;
    }

    const elapsed = this.flowStartTime ? Date.now() - this.flowStartTime : 0;

    let html = `
      <div style="margin-bottom: 8px;">
        <strong>Current State:</strong><br/>
        <span style="color: #ff0;">${this.currentState}</span>
      </div>

      <div style="margin-bottom: 8px;">
        <strong>Elapsed Time:</strong><br/>
        ${elapsed}ms (${(elapsed / 1000).toFixed(2)}s)
      </div>

      <div style="margin-bottom: 8px;">
        <strong>Avatar URLs:</strong><br/>
        Base: ${this.baseAvatarUrl ? '✓' : '✗'}<br/>
        Cool: ${this.coolAvatarUrl ? '✓' : '✗'}
      </div>

      <div style="margin-bottom: 8px;">
        <strong>Selected:</strong><br/>
        ${this.selectedVariant || 'none'}
      </div>

      <div>
        <strong>State History:</strong><br/>
        <div style="max-height: 200px; overflow-y: auto; font-size: 10px; margin-top: 4px;">
    `;

    this.stateHistory.forEach((entry, index) => {
      html += `
        <div style="margin-bottom: 2px; padding: 2px; background: rgba(0, 255, 0, 0.1);">
          ${index + 1}. ${entry.from} → ${entry.to}<br/>
          <span style="color: #888;">${entry.elapsed}ms</span>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;

    content.innerHTML = html;
  }

  async start() {
    if (this.currentState !== FlowState.IDLE) {
      throw new Error(`[RevealFlow] Cannot start: already in state ${this.currentState}`);
    }

    this._debugLog('[RevealFlow] Starting exclusive avatar reveal flow');
    this.flowStartTime = Date.now();

    await this._transitionTo(FlowState.SPLASH_SCREEN);
  }

  getCurrentState() {
    return this.currentState;
  }

  addEventListener(event, callback) {
    if (typeof callback !== 'function') {
      throw new Error('[RevealFlow] Callback must be a function');
    }

    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }

    this.eventListeners.get(event).push(callback);
    this._debugLog(`[RevealFlow] Added listener for event: ${event}`);
  }

  removeEventListener(event, callback) {
    if (!this.eventListeners.has(event)) {
      return;
    }

    const callbacks = this.eventListeners.get(event);
    const index = callbacks.indexOf(callback);

    if (index !== -1) {
      callbacks.splice(index, 1);
      this._debugLog(`[RevealFlow] Removed listener for event: ${event}`);
    }

    if (callbacks.length === 0) {
      this.eventListeners.delete(event);
    }
  }

  _emitEvent(eventName, data) {
    if (!this.eventListeners.has(eventName)) {
      return;
    }

    const callbacks = this.eventListeners.get(eventName);
    callbacks.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`[RevealFlow] Error in event listener for ${eventName}:`, error);
      }
    });
  }

  _logStateTransition(from, to) {
    const timestamp = Date.now();
    const elapsed = this.flowStartTime ? timestamp - this.flowStartTime : 0;

    this._debugLog(`[RevealFlow] State transition: ${from} → ${to} (${elapsed}ms elapsed)`);

    this.stateHistory.push({
      from,
      to,
      timestamp,
      elapsed
    });
  }

  _logError(error, context) {
    const timestamp = Date.now();
    const elapsed = this.flowStartTime ? timestamp - this.flowStartTime : 0;

    console.error(`[RevealFlow] ERROR in ${context} (${elapsed}ms elapsed):`, {
      message: error.message,
      stack: error.stack,
      currentState: this.currentState,
      stateHistory: this.stateHistory,
      baseAvatarUrl: this.baseAvatarUrl,
      coolAvatarUrl: this.coolAvatarUrl,
      coolAvatarLoaded: this.coolAvatarLoaded,
      selectedVariant: this.selectedVariant
    });
  }

  _logTiming(label, duration, metadata = {}) {
    const timestamp = Date.now();
    const elapsed = this.flowStartTime ? timestamp - this.flowStartTime : 0;

    this._debugLog(`[RevealFlow] TIMING: ${label} took ${duration}ms (${elapsed}ms total elapsed)`, metadata);
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async _transitionTo(newState) {
    const oldState = this.currentState;

    this._logStateTransition(oldState, newState);

    this.currentState = newState;

    this._updateDebugPanel();

    this._emitEvent('stateChange', {
      from: oldState,
      to: newState,
      timestamp: Date.now()
    });

    try {
      switch (newState) {
        case FlowState.SPLASH_SCREEN:
          await this._executeSplashScreen();
          break;
        case FlowState.BASE_AVATAR_DISPLAY:
          await this._executeBaseAvatarDisplay();
          break;
        case FlowState.CONFIRMATION_PENDING:
          await this._executeConfirmationPending();
          break;
        case FlowState.LOGUM_APPEARANCE:
          await this._executeLogumAppearance();
          break;
        case FlowState.GENERATION_ANIMATION:
          await this._executeGenerationAnimation();
          break;
        case FlowState.COOL_AVATAR_DISPLAY:
          await this._executeCoolAvatarDisplay();
          break;
        case FlowState.CHOICE_PENDING:
          await this._executeChoicePending();
          break;
        case FlowState.COMPLETED:
          await this._executeCompleted();
          break;
        default:
          console.warn(`[RevealFlow] No execution logic for state: ${newState}`);
      }
    } catch (error) {
      console.error(`[RevealFlow] Error executing state ${newState}:`, error);
      this._logError(error, `_transitionTo(${newState})`);
      await this._handleError(error, { state: newState });
    }
  }

  async _executeSplashScreen() {
    this._debugLog('[RevealFlow] Entering SPLASH_SCREEN state');

    const startTime = Date.now();

    const splashElement = this.personaSystem.renderSplashScreen();

    this.overlayElement = splashElement;

    document.body.appendChild(splashElement);

    // requestAnimationFrame ensures the element is in the DOM before we apply transitions
    await new Promise(resolve => {
      requestAnimationFrame(() => {
        splashElement.style.opacity = '1';

        const splashMessage = splashElement.querySelector('.exclusive-splash-message');
        if (splashMessage) {
          requestAnimationFrame(() => {
            splashMessage.style.opacity = '1';
            splashMessage.style.transform = 'translateY(0)';
          });
        }

        resolve();
      });
    });

    await this._delay(this.config.splashScreenDuration);

    const duration = Date.now() - startTime;

    this._emitEvent('splashComplete', { duration });

    await this._transitionTo(FlowState.BASE_AVATAR_DISPLAY);
  }

  async _executeBaseAvatarDisplay() {
    this._debugLog('[RevealFlow] Entering BASE_AVATAR_DISPLAY state');

    try {
      await this._delay(this.config.baseAvatarDelay);

      const avatarCard = this.personaSystem.renderBaseAvatarCard();
      this._debugLog('[RevealFlow] Avatar card rendered:', avatarCard);
      this._debugLog('[RevealFlow] Avatar card HTML:', avatarCard.outerHTML.substring(0, 200));

      const overlay = document.getElementById('exclusive-persona-overlay');
      if (!overlay) {
        throw new Error('[RevealFlow] Overlay not found for BASE_AVATAR_DISPLAY');
      }

      const content = overlay.querySelector('.exclusive-splash-content') || overlay.querySelector('div');
      if (!content) {
        throw new Error('[RevealFlow] Content container not found in overlay');
      }

      const splashMessage = content.querySelector('.exclusive-splash-message');
      if (splashMessage) {
        splashMessage.style.opacity = '0';
        splashMessage.style.transform = 'translateY(-20px)';
        await this._delay(300);
        splashMessage.remove();
      }

      content.appendChild(avatarCard);
      this._debugLog('[RevealFlow] ✅ Avatar card appended to content');

      await this._delay(50);

      // Force reflow so the CSS transition fires correctly
      void avatarCard.offsetHeight;

      const computedBefore = window.getComputedStyle(avatarCard);
      this._debugLog('[RevealFlow] 📊 Avatar card BEFORE animation (computed styles):', {
        opacity: computedBefore.opacity,
        transform: computedBefore.transform,
        display: computedBefore.display,
        visibility: computedBefore.visibility
      });

      // Double requestAnimationFrame: first ensures layout, second fires the transition
      await new Promise(resolve => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            avatarCard.style.opacity = '1';
            avatarCard.style.transform = 'scale(1) translateY(0)';

            void avatarCard.offsetHeight;

            resolve();
          });
        });
      });

      await this._delay(this.config.slideUpDuration);

      this._emitEvent('baseAvatarShown', {
        avatarUrl: this.personaSystem.baseAvatarUrl,
        timestamp: Date.now()
      });

      this._debugLog('[RevealFlow] Base avatar displayed successfully');

      await this._transitionTo(FlowState.CONFIRMATION_PENDING);

    } catch (error) {
      console.error('[RevealFlow] Error in BASE_AVATAR_DISPLAY state:', error);
      throw error;
    }
  }

  async _executeConfirmationPending() {
    this._debugLog('[RevealFlow] 🎯 Entering CONFIRMATION_PENDING state');

    await this._delay(this.config.confirmButtonDelay);

    let buttonClicked = false;

    const confirmButton = this.personaSystem.renderConfirmationButton(async () => {
      if (buttonClicked) {
        this._debugLog('[RevealFlow] ⚠️ Button already clicked, ignoring duplicate click');
        return;
      }

      this._debugLog('[RevealFlow] 🖱️ User clicked confirmation button (first click)');
      buttonClicked = true;

      confirmButton.disabled = true;
      confirmButton.style.opacity = '0.5';
      confirmButton.style.cursor = 'not-allowed';

      this._emitEvent('confirmationClick', { timestamp: Date.now() });

      confirmButton.style.opacity = '0';
      await this._delay(300);

      if (confirmButton.parentNode) {
        confirmButton.remove();
      }

      await this._transitionTo(FlowState.LOGUM_APPEARANCE);
    });

    this.confirmButtonElement = confirmButton;

    const overlay = document.getElementById('exclusive-persona-overlay');
    if (!overlay) {
      console.error('[RevealFlow] ❌ Overlay element not found!');
      throw new Error('[RevealFlow] Overlay element not found');
    }

    const content = overlay.querySelector('.exclusive-splash-content') || overlay.querySelector('.content');
    if (!content) {
      console.error('[RevealFlow] ❌ Overlay content element not found!');
      throw new Error('[RevealFlow] Overlay content element not found');
    }

    content.appendChild(confirmButton);
    this._debugLog('[RevealFlow] ✅ Button appended to content');

    requestAnimationFrame(() => {
      confirmButton.style.opacity = '1';
    });

    this._debugLog('[RevealFlow] ⏸️ Waiting for user to click confirmation button...');
  }

  async _executeLogumAppearance() {
    this._debugLog('[RevealFlow] Entering LOGUM_APPEARANCE state');

    try {
      await this._delay(this.config.logumAppearanceDelay);

      this.logumController.initializeFace();
      this.logumController.startGazeAnimation();
      this.logumController.startBlinkAnimation();

      this._debugLog('[RevealFlow] Logum initialized (invisible, will appear when speaking)');

      await this._typeMessageCharByChar('Hmm... 😎 Tenho uma ideia.', {
        charDelay: this.config.messageTypingSpeed,
        showDots: false,
        autoHide: true,
        hideDelay: 2000
      });

      this._emitEvent('logumAppeared', {
        timestamp: Date.now()
      });

      this._debugLog('[RevealFlow] Logum ready');

      await this._transitionTo(FlowState.GENERATION_ANIMATION);

    } catch (error) {
      console.error('[RevealFlow] Error in LOGUM_APPEARANCE state:', error);
      throw error;
    }
  }

  async _executeGenerationAnimation() {
    this._debugLog('[RevealFlow] Entering GENERATION_ANIMATION state');

    const startTime = Date.now();

    try {
      this._emitEvent('generationStart', { timestamp: Date.now() });

      const message = 'Só um ajuste rapidinho';
      await this._typeMessageCharByChar(message, {
        charDelay: this.config.messageTypingSpeed,
        showDots: true,
        autoHide: true,
        hideDelay: 2000
      });

      const animationOverlay = this.personaSystem.renderGenerationAnimation();

      const overlay = document.getElementById('exclusive-persona-overlay');
      if (!overlay) {
        throw new Error('[RevealFlow] Overlay not found for GENERATION_ANIMATION');
      }

      // Uses data-attribute selector — class-based would conflict with CSS specificity
      const avatarCard = overlay.querySelector('[data-exclusive-avatar-card="true"]');
      if (!avatarCard) {
        console.error('[RevealFlow] ❌ Avatar card not found! Looking for [data-exclusive-avatar-card="true"]');
        throw new Error('[RevealFlow] Avatar card not found for GENERATION_ANIMATION');
      }

      this._debugLog('[RevealFlow] ✅ Avatar card found for generation animation');

      avatarCard.style.position = 'relative';

      avatarCard.appendChild(animationOverlay);

      await new Promise(resolve => {
        requestAnimationFrame(() => {
          animationOverlay.style.opacity = '1';
          resolve();
        });
      });

      const coolLoadPromise = this.personaSystem.checkCoolVersion();
      const timeoutPromise = this._delay(this.config.coolAvatarLoadTimeout).then(() => {
        console.warn('[RevealFlow] Cool avatar load timeout (5000ms)');
        return { exists: false, url: null, timedOut: true };
      });

      const [coolResult] = await Promise.all([
        Promise.race([coolLoadPromise, timeoutPromise]),
        this._delay(this.config.generationAnimationDuration)
      ]);

      const duration = Date.now() - startTime;

      this._emitEvent('generationComplete', {
        duration,
        coolLoaded: coolResult.exists,
        timedOut: coolResult.timedOut || false,
        timestamp: Date.now()
      });

      animationOverlay.style.opacity = '0';
      await this._delay(300);
      animationOverlay.remove();

      if (coolResult.exists) {
        this.coolAvatarLoaded = true;
        this.coolAvatarUrl = coolResult.url;
        this._debugLog('[RevealFlow] Cool avatar loaded, transitioning to COOL_AVATAR_DISPLAY');
        await this._transitionTo(FlowState.COOL_AVATAR_DISPLAY);
      } else {
        this._debugLog('[RevealFlow] Cool avatar not available, completing with base avatar');

        this.personaSystem.saveSelection('base');
        this.selectedVariant = 'base';

        await this._transitionTo(FlowState.COMPLETED);
      }

    } catch (error) {
      console.error('[RevealFlow] Error in GENERATION_ANIMATION state:', error);
      throw error;
    }
  }

  async _typeMessageCharByChar(message, options = {}) {
    const { charDelay = 50, showDots = true, autoHide = true, hideDelay = 2000 } = options;

    await this.logumController.fadeIn();

    let messageContainer = this.logumController.container.querySelector('.logum-message');
    if (!messageContainer) {
      messageContainer = document.createElement('div');
      messageContainer.className = 'logum-message';
      Object.assign(messageContainer.style, {
        marginTop: '16px',
        fontSize: '14px',
        color: 'var(--white, #FAFAFA)',
        fontFamily: 'var(--font, Inter, sans-serif)',
        textAlign: 'center',
        width: '200px',
        maxWidth: '200px',
        minWidth: '200px',
        wordWrap: 'break-word',
        whiteSpace: 'normal',
        lineHeight: '1.4',
        opacity: '1',
        transform: 'translateY(0)'
      });

      messageContainer.setAttribute('role', 'status');
      messageContainer.setAttribute('aria-live', 'polite');
      messageContainer.setAttribute('aria-label', 'Mensagem do Sentury');

      this.logumController.container.appendChild(messageContainer);
    } else {
      messageContainer.textContent = '';
    }

    if (showDots) {
      messageContainer.innerHTML = '<span class="logum-dots">...</span>';
      this._injectDotsAnimation();
      await this._delay(300);
    }

    messageContainer.textContent = '';

    for (let i = 0; i < message.length; i++) {
      messageContainer.textContent += message[i];

      if (i < message.length - 1) {
        await this._delay(charDelay);
      }
    }

    this._debugLog('[RevealFlow] Message typed character-by-character:', message);

    if (autoHide) {
      await this._delay(hideDelay);
      await this.logumController.fadeOut();
    }
  }

  _injectDotsAnimation() {
    const styleId = 'logum-dots-animation';
    if (document.getElementById(styleId)) {
      return;
    }

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .logum-dots {
        display: inline-block;
        animation: logum-dots-pulse 1.4s steps(4, end) infinite;
      }

      @keyframes logum-dots-pulse {
        0% { content: ''; }
        25% { content: '.'; }
        50% { content: '..'; }
        75% { content: '...'; }
      }
    `;

    document.head.appendChild(style);
  }

  async _executeCoolAvatarDisplay() {
    this._debugLog('[RevealFlow] Entering COOL_AVATAR_DISPLAY state');

    try {
      this._debugLog('[RevealFlow] Executing cool avatar transition...');
      await this.personaSystem.renderCoolAvatarTransition();
      this._debugLog('[RevealFlow] Cool avatar transition complete');

      await this._delay(this.config.choiceButtonsDelay);

      await this._typeMessageCharByChar(
        '😎 gostei… e você?',
        {
          charDelay: this.config.messageTypingSpeed,
          showDots: false,
          autoHide: true,
          hideDelay: 2000
        }
      );

      await this._transitionTo(FlowState.CHOICE_PENDING);

    } catch (error) {
      console.error('[RevealFlow] Error in COOL_AVATAR_DISPLAY state:', error);
      throw error;
    }
  }

  async _executeChoicePending() {
    this._debugLog('[RevealFlow] Entering CHOICE_PENDING state');

    try {
      await this._delay(500);

      const choiceButtons = this.personaSystem.renderChoiceButtons(async (variant) => {
        this._debugLog('[RevealFlow] User confirmed selection:', variant);

        const filename = this.personaSystem.saveSelection(variant);

        this.selectedVariant = variant;

        this._emitEvent('choiceMade', {
          variant: variant,
          filename: filename,
          timestamp: Date.now()
        });

        await this._delay(this.config.selectionFeedbackDuration);

        await this._typeMessageCharByChar('Boa escolha... te redirecionando para o login', {
          charDelay: this.config.messageTypingSpeed,
          showDots: false,
          autoHide: true,
          hideDelay: 1500
        });

        await this._transitionTo(FlowState.COMPLETED);
      });

      const overlay = document.getElementById('exclusive-persona-overlay');
      if (!overlay) {
        throw new Error('[RevealFlow] Overlay element not found');
      }

      const content = overlay.querySelector('.exclusive-splash-content') || overlay.querySelector('.content');
      if (!content) {
        throw new Error('[RevealFlow] Overlay content element not found');
      }

      content.appendChild(choiceButtons);

      await new Promise(resolve => {
        requestAnimationFrame(() => {
          choiceButtons.style.opacity = '1';
          choiceButtons.style.transform = 'translateY(0)';
          resolve();
        });
      });

      this._debugLog('[RevealFlow] Choice buttons displayed, waiting for user selection');

    } catch (error) {
      console.error('[RevealFlow] Error in CHOICE_PENDING state:', error);
      throw error;
    }
  }

  async _executeCompleted() {
    this._debugLog('[RevealFlow] Entering COMPLETED state');

    try {
      const totalDuration = this.flowStartTime ? Date.now() - this.flowStartTime : 0;
      this._debugLog(`[RevealFlow] Flow completed in ${totalDuration}ms`);

      const selectedAvatar = this.selectedVariant === 'cool'
        ? this.coolAvatarUrl?.split('/').pop()
        : this.baseAvatarUrl?.split('/').pop();

      this._emitEvent('flowComplete', {
        totalDuration,
        selectedAvatar: selectedAvatar || 'unknown',
        variant: this.selectedVariant,
        coolAvatarLoaded: this.coolAvatarLoaded,
        timestamp: Date.now()
      });

      this._debugLog(`[RevealFlow] Waiting ${this.config.redirectDelay}ms before cleanup...`);
      await this._delay(this.config.redirectDelay);

      const overlay = document.getElementById('exclusive-persona-overlay');
      if (overlay) {
        overlay.style.transition = `opacity ${this.config.fadeInDuration}ms ease-out`;
        overlay.style.opacity = '0';

        await this._delay(this.config.fadeInDuration);

        overlay.remove();
        this.overlayElement = null;
      }

      this.eventListeners.clear();

      this.confirmButtonElement = null;

      if (this.logumController) {
        if (this.logumController.gazeInterval) {
          clearInterval(this.logumController.gazeInterval);
          this.logumController.gazeInterval = null;
        }

        if (this.logumController.blinkTimeout) {
          clearTimeout(this.logumController.blinkTimeout);
          this.logumController.blinkTimeout = null;
        }

        if (this.logumController.container) {
          this.logumController.container.style.display = 'none';
        }
      }

      this._debugLog('[RevealFlow] Flow completed successfully');

    } catch (error) {
      console.error('[RevealFlow] Error in COMPLETED state:', error);
      // Cleanup errors are non-critical — emit and continue
      this._emitEvent('error', {
        state: 'COMPLETED',
        error,
        message: 'Cleanup error (non-critical)'
      });
    }
  }

  async _handleError(error, context) {
    console.error(`[RevealFlow] Error in state ${this.currentState}:`, error);
    console.error('[RevealFlow] Error details:', {
      state: this.currentState,
      context,
      errorMessage: error.message,
      errorStack: error.stack
    });

    this._emitEvent('error', {
      state: this.currentState,
      error,
      context,
      timestamp: Date.now()
    });

    try {
      switch (this.currentState) {
        case FlowState.SPLASH_SCREEN:
        case FlowState.BASE_AVATAR_DISPLAY:
          this._debugLog('[RevealFlow] Critical error in early state - falling back to standard flow');
          this._fallbackToStandardFlow();
          break;

        case FlowState.CONFIRMATION_PENDING:
        case FlowState.LOGUM_APPEARANCE:
          this._debugLog('[RevealFlow] Error in confirmation/logum state - skipping to completion with base avatar');
          if (this.personaSystem.baseAvatarUrl) {
            this.personaSystem.saveSelection('base');
            this.selectedVariant = 'base';
          }
          await this._transitionTo(FlowState.COMPLETED);
          break;

        case FlowState.GENERATION_ANIMATION:
          this._debugLog('[RevealFlow] Error in generation animation - completing with base avatar');
          if (this.personaSystem.baseAvatarUrl) {
            this.personaSystem.saveSelection('base');
            this.selectedVariant = 'base';
          }
          await this._transitionTo(FlowState.COMPLETED);
          break;

        case FlowState.COOL_AVATAR_DISPLAY:
        case FlowState.CHOICE_PENDING:
          this._debugLog('[RevealFlow] Error in cool avatar/choice state - using base avatar');
          if (this.personaSystem.baseAvatarUrl) {
            this.personaSystem.saveSelection('base');
            this.selectedVariant = 'base';
          }
          await this._transitionTo(FlowState.COMPLETED);
          break;

        case FlowState.COMPLETED:
          this._debugLog('[RevealFlow] Error in COMPLETED state - cleaning up');
          const overlay = document.getElementById('exclusive-persona-overlay');
          if (overlay) {
            overlay.remove();
          }
          break;

        default:
          console.warn('[RevealFlow] Error in unknown state - resetting to IDLE');
          this.currentState = FlowState.IDLE;
          this._emitEvent('reset', {
            reason: 'error_recovery',
            previousState: context.state,
            timestamp: Date.now()
          });

          const overlayElement = document.getElementById('exclusive-persona-overlay');
          if (overlayElement) {
            overlayElement.remove();
          }
      }
    } catch (recoveryError) {
      console.error('[RevealFlow] Recovery strategy failed:', recoveryError);
      this._fallbackToStandardFlow();
    }
  }

  _fallbackToStandardFlow() {
    this._debugLog('[RevealFlow] Falling back to standard avatar selection flow');

    try {
      const overlay = document.getElementById('exclusive-persona-overlay');
      if (overlay) {
        overlay.remove();
      }

      if (this.logumController && this.logumController.container) {
        this.logumController.hide();
      }

      this.currentState = FlowState.IDLE;

      this._emitEvent('fallback', {
        reason: 'critical_error',
        timestamp: Date.now()
      });

      this._debugLog('[RevealFlow] Fallback complete - user can select standard avatar');

    } catch (error) {
      console.error('[RevealFlow] Error during fallback:', error);

      try {
        const overlay = document.getElementById('exclusive-persona-overlay');
        if (overlay) {
          overlay.remove();
        }
      } catch (e) {
        console.error('[RevealFlow] Could not remove overlay:', e);
      }
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ExclusiveAvatarRevealFlow,
    FlowState
  };
}

if (typeof window !== 'undefined') {
  window.ExclusiveAvatarRevealFlow = ExclusiveAvatarRevealFlow;
  window.FlowState = FlowState;
}
