function logumDebugLog(...args) {
  if (typeof window !== 'undefined' && window.CX_DEBUG === true) {
    console.debug(...args);
  }
}

class LogumAnimationController {
  constructor(containerElement) {
    if (!containerElement) {
      throw new Error('Container element is required');
    }

    this.container = containerElement;
    this.currentMessage = null;
    this.faceElement = null;
    this.leftBar = null;
    this.rightBar = null;
    this.gazeIndex = 0;
    this.gazeInterval = null;
    this.blinkTimeout = null;

    // Gaze positions: eyes move together via translateX/translateY
    this.gazePositions = [
      { x: 0, y: 0 },
      { x: 0, y: -12 },
      { x: 0, y: 12 },
      { x: -6, y: 12 },
      { x: 6, y: 12 },
      { x: -6, y: 12 },
      { x: 6, y: 12 },
      { x: 0, y: 0 },
      { x: -8, y: 0 },
      { x: 8, y: 0 },
      { x: -8, y: 12 },
      { x: 8, y: 12 },
      { x: -8, y: -12 },
      { x: 8, y: -12 },
      { x: 0, y: 0 }
    ];
  }

  async animateAppearance() {
    this.initializeFace();

    this.container.classList.add('visible');
    this.container.style.opacity = '0';

    // Force reflow so the CSS transition picks up the opacity change
    this.container.offsetHeight;

    requestAnimationFrame(() => {
      this.container.style.opacity = '1';
    });

    await this._delay(500);

    this.startGazeAnimation();
    this.startBlinkAnimation();
  }

  initializeFace() {
    const nameTag = document.createElement('div');
    nameTag.className = 'logum-nametag';
    nameTag.textContent = 'Sentury';
    Object.assign(nameTag.style, {
      fontSize: '12px',
      fontWeight: '600',
      color: 'var(--white, #FAFAFA)',
      background: 'rgba(0, 0, 0, 0.5)',
      padding: '4px 8px',
      borderRadius: '4px',
      marginBottom: '8px',
      textAlign: 'center',
      textShadow: '1px 1px 2px rgba(0, 0, 0, 0.8)',
      whiteSpace: 'nowrap'
    });

    this.faceElement = document.createElement('div');
    this.faceElement.className = 'logum-face';

    Object.assign(this.faceElement.style, {
      width: '96px',
      height: '96px',
      border: '2.5px solid var(--white, #FAFAFA)',
      borderRadius: '50%',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '14px',
      flexShrink: '0',
      animation: 'logum-breath 4s ease-in-out infinite'
    });

    this.leftBar = document.createElement('div');
    this.leftBar.className = 'logum-bar';
    this.applyBarStyles(this.leftBar);

    this.rightBar = document.createElement('div');
    this.rightBar.className = 'logum-bar';
    this.applyBarStyles(this.rightBar);

    this.faceElement.appendChild(this.leftBar);
    this.faceElement.appendChild(this.rightBar);

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
    `;
    wrapper.appendChild(nameTag);
    wrapper.appendChild(this.faceElement);

    this.container.appendChild(wrapper);

    this.injectBreathingAnimation();
  }

  applyBarStyles(bar) {
    Object.assign(bar.style, {
      width: '9px',
      height: '22px',
      background: 'var(--white, #FAFAFA)',
      borderRadius: '4px',
      flexShrink: '0',
      transition: 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), height 0.07s ease'
    });
  }

  injectBreathingAnimation() {
    const styleId = 'logum-breath-animation';
    if (document.getElementById(styleId)) {
      return;
    }

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes logum-breath {
        0%, 100% {
          box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.05);
        }
        50% {
          box-shadow: 0 0 0 8px rgba(255, 255, 255, 0.02);
        }
      }
    `;

    document.head.appendChild(style);
  }

  startGazeAnimation() {
    if (this.gazeInterval) {
      clearInterval(this.gazeInterval);
    }

    this.gazeInterval = setInterval(() => {
      this.animateGaze();
    }, 440);
  }

  animateGaze() {
    this.gazeIndex = (this.gazeIndex + 1) % this.gazePositions.length;
    const { x, y } = this.gazePositions[this.gazeIndex];

    const transform = `translate(${x}px, ${y}px)`;
    this.leftBar.style.transform = transform;
    this.rightBar.style.transform = transform;
  }

  startBlinkAnimation() {
    if (this.blinkTimeout) {
      clearTimeout(this.blinkTimeout);
    }

    const nextBlinkDelay = 2000 + Math.random() * 3000;
    this.blinkTimeout = setTimeout(() => {
      this.animateBlink();
    }, nextBlinkDelay);
  }

  animateBlink() {
    this.leftBar.classList.add('logum-blink');
    this.rightBar.classList.add('logum-blink');

    this.leftBar.style.height = '3px';
    this.leftBar.style.borderRadius = '2px';
    this.rightBar.style.height = '3px';
    this.rightBar.style.borderRadius = '2px';

    setTimeout(() => {
      this.leftBar.classList.remove('logum-blink');
      this.rightBar.classList.remove('logum-blink');
      this.leftBar.style.height = '22px';
      this.leftBar.style.borderRadius = '4px';
      this.rightBar.style.height = '22px';
      this.rightBar.style.borderRadius = '4px';

      this.startBlinkAnimation();
    }, 130);
  }

  async typeMessage(message, options = {}) {
    const { wordDelay = 50, charDelay = null, showDots = true, autoHide = false, hideDelay = 2000 } = options;

    let messageContainer = this.container.querySelector('.logum-message');
    if (!messageContainer) {
      messageContainer = document.createElement('div');
      messageContainer.className = 'logum-message';
      Object.assign(messageContainer.style, {
        marginTop: '16px',
        fontSize: '14px',
        color: 'var(--white, #FAFAFA)',
        fontFamily: 'var(--font, Inter, sans-serif)',
        textAlign: 'center'
      });
      this.container.appendChild(messageContainer);
    }

    if (showDots) {
      messageContainer.innerHTML = '<span class="logum-dots">...</span>';
      this.injectDotsAnimation();
      await this._delay(1000);
    }

    messageContainer.innerHTML = '';

    if (charDelay !== null) {
      const characters = message.split('');

      for (let i = 0; i < characters.length; i++) {
        messageContainer.textContent += characters[i];

        if (i < characters.length - 1) {
          await this._delay(charDelay);
        }
      }
    } else {
      const words = message.split(' ');

      for (let i = 0; i < words.length; i++) {
        if (i > 0) {
          messageContainer.textContent += ' ';
        }
        messageContainer.textContent += words[i];

        if (i < words.length - 1) {
          await this._delay(wordDelay);
        }
      }
    }

    this.currentMessage = message;

    if (autoHide) {
      await this._delay(hideDelay);
      await this.fadeOut();
    }
  }

  async fadeOut() {
    this.container.style.opacity = '0';
    await this._delay(500);
    this.container.classList.remove('visible');
  }

  async fadeIn() {
    this.container.classList.add('visible');
    await this._delay(50);
    this.container.style.opacity = '1';
    await this._delay(500);
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  injectDotsAnimation() {
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

  // Stops gaze animation and centers eyes to face the player
  stopGazeAndLookAtPlayer() {
    if (this.gazeInterval) {
      clearInterval(this.gazeInterval);
      this.gazeInterval = null;
    }

    const transform = 'translate(0px, 0px)';
    this.leftBar.style.transform = transform;
    this.rightBar.style.transform = transform;

    logumDebugLog('[LogumAnimationController] Stopped gaze, looking at player (center)');
  }

  resumeGazeAnimation() {
    if (!this.gazeInterval) {
      this.startGazeAnimation();
      logumDebugLog('[LogumAnimationController] Resumed gaze animation');
    }
  }

  async showFinalMessage() {
    await this.typeMessage('Agora sim 😎 Te encontro na Experience Connect', {
      wordDelay: 60,
      showDots: false
    });

    await this._delay(2000);
  }

  hide() {
    if (this.gazeInterval) {
      clearInterval(this.gazeInterval);
      this.gazeInterval = null;
    }

    if (this.blinkTimeout) {
      clearTimeout(this.blinkTimeout);
      this.blinkTimeout = null;
    }

    this.container.style.opacity = '0';

    setTimeout(() => {
      this.container.classList.remove('visible');
      if (this.container.parentNode) {
        this.container.parentNode.removeChild(this.container);
      }
    }, 500);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LogumAnimationController;
}

if (typeof window !== 'undefined') {
  window.LogumAnimationController = LogumAnimationController;
}
