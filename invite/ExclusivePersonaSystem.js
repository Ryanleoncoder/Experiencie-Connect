function personaDebugLog(...args) {
  if (typeof window !== 'undefined' && window.CX_DEBUG === true) {
    console.debug(...args);
  }
}

class ExclusivePersonaSystem {
  constructor(nickname, options = {}) {
    personaDebugLog('[ExclusivePersonaSystem] Creating ExclusivePersonaSystem instance');

    this.nickname = nickname;
    this.normalizedNickname = this.normalizeNickname(nickname);
    
    this.isExclusive = false;
    this.baseAvatarUrl = null;
    this.coolAvatarUrl = null;
    this.selectedVariant = null;
    
    this.onComplete = options.onComplete || (() => {});
  }

  // Lowercase, trim, remove spaces — matches avatar filename convention
  normalizeNickname(nickname) {
    return nickname
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '');
  }

  // Checks for {normalizedNickname}.webp then .png. Sets isExclusive and baseAvatarUrl.
  async detectExclusiveAvatar() {
    const avatarBasePath = '/frontend/assets/image/avatar';

    personaDebugLog('[ExclusivePersonaSystem] Detecting exclusive avatar');

    try {
      const webpUrl = `${avatarBasePath}/${this.normalizedNickname}.webp`;
      personaDebugLog('[ExclusivePersonaSystem] Checking webp:', webpUrl);
      const webpExists = await this.checkFileExists(webpUrl);
      personaDebugLog('[ExclusivePersonaSystem] Webp exists:', webpExists);

      if (webpExists) {
        this.isExclusive = true;
        this.baseAvatarUrl = webpUrl;
        personaDebugLog('[ExclusivePersonaSystem] ✅ Exclusive avatar found (webp):', webpUrl);
        return { exists: true, url: webpUrl };
      }

      const pngUrl = `${avatarBasePath}/${this.normalizedNickname}.png`;
      personaDebugLog('[ExclusivePersonaSystem] Checking png:', pngUrl);
      const pngExists = await this.checkFileExists(pngUrl);
      personaDebugLog('[ExclusivePersonaSystem] Png exists:', pngExists);

      if (pngExists) {
        this.isExclusive = true;
        this.baseAvatarUrl = pngUrl;
        personaDebugLog('[ExclusivePersonaSystem] ✅ Exclusive avatar found (png):', pngUrl);
        return { exists: true, url: pngUrl };
      }

      personaDebugLog('[ExclusivePersonaSystem] ❌ No exclusive avatar found');
      return { exists: false, url: null };

    } catch (error) {
      console.error('[ExclusivePersonaSystem] Error detecting exclusive avatar:', error);
      return { exists: false, url: null };
    }
  }

  // HEAD first (efficient), falls back to GET if HEAD is blocked
  async checkFileExists(url) {
    personaDebugLog('[ExclusivePersonaSystem] checkFileExists - Checking URL:', url);

    try {
      const response = await fetch(url, { method: 'HEAD' });
      personaDebugLog('[ExclusivePersonaSystem] checkFileExists - HEAD response status:', response.status, 'ok:', response.ok);
      return response.ok;
    } catch (error) {
      personaDebugLog('[ExclusivePersonaSystem] checkFileExists - HEAD request failed:', error.message);
      try {
        const response = await fetch(url);
        personaDebugLog('[ExclusivePersonaSystem] checkFileExists - GET response status:', response.status, 'ok:', response.ok);
        return response.ok;
      } catch (fallbackError) {
        personaDebugLog('[ExclusivePersonaSystem] checkFileExists - GET request also failed:', fallbackError.message);
        return false;
      }
    }
  }

  // Checks for {normalizedNickname}cool.webp then .png. Priority: .webp > .png.
  async checkCoolVersion() {
    const avatarBasePath = '/frontend/assets/image/avatar';

    try {
      const webpUrl = `${avatarBasePath}/${this.normalizedNickname}cool.webp`;
      const webpExists = await this.checkFileExists(webpUrl);

      if (webpExists) {
        this.coolAvatarUrl = webpUrl;
        return { exists: true, url: webpUrl };
      }

      const pngUrl = `${avatarBasePath}/${this.normalizedNickname}cool.png`;
      const pngExists = await this.checkFileExists(pngUrl);

      if (pngExists) {
        this.coolAvatarUrl = pngUrl;
        return { exists: true, url: pngUrl };
      }

      return { exists: false, url: null };

    } catch (error) {
      console.error('Error checking cool version:', error);
      return { exists: false, url: null };
    }
  }

  renderSplashScreen() {
    const overlay = document.createElement('div');
    overlay.id = 'exclusive-persona-overlay';
    overlay.className = 'exclusive-splash-overlay';

    const content = document.createElement('div');
    content.className = 'exclusive-splash-content';

    const splashMessage = document.createElement('div');
    splashMessage.className = 'exclusive-splash-message';
    splashMessage.textContent = 'Espera ✋🏾 Temos algo especial para você.';

    splashMessage.style.opacity = '0';
    splashMessage.style.transform = 'translateY(20px)';

    splashMessage.setAttribute('role', 'alert');
    splashMessage.setAttribute('aria-live', 'polite');
    splashMessage.setAttribute('aria-label', 'Espera, temos algo especial para você');

    content.appendChild(splashMessage);

    overlay.appendChild(content);

    return overlay;
  }

  renderBaseAvatarCard() {
    personaDebugLog('[ExclusivePersonaSystem] 🎨 Rendering base avatar card...');

    const avatarCard = document.createElement('div');
    // Do not set className — all styles are inline to avoid CSS specificity conflicts
    avatarCard.setAttribute('data-exclusive-avatar-card', 'true');

    avatarCard.style.cssText = `
      opacity: 0;
      transform: scale(0.9) translateY(30px);
      transition: opacity 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
      position: relative;
      background: #141414;
      border: 2px solid #FFD600;
      border-radius: 24px;
      padding: 32px;
      max-width: 90vw;
      box-shadow: 0 0 40px rgba(255, 214, 0, 0.3), 0 0 80px rgba(255, 214, 0, 0.15);
      display: block;
      visibility: visible;
    `;
    
    avatarCard.setAttribute('role', 'region');
    avatarCard.setAttribute('aria-label', `Avatar exclusivo de ${this.nickname}`);

    const avatarImageContainer = document.createElement('div');
    avatarImageContainer.style.cssText = `
      width: 200px;
      height: 200px;
      margin: 0 auto 24px;
      border-radius: 12px;
      overflow: hidden;
      border: 2px solid #FFD600;
      box-shadow: 0 0 20px rgba(255, 214, 0, 0.2);
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0A0A0A;
    `;

    const avatarImage = document.createElement('img');
    avatarImage.src = this.baseAvatarUrl;
    avatarImage.alt = 'Seu avatar exclusivo';
    avatarImage.style.cssText = `
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    `;

    avatarImageContainer.appendChild(avatarImage);

    const avatarName = document.createElement('h2');
    avatarName.textContent = this.nickname;
    avatarName.style.cssText = `
      font-size: 1.75rem;
      font-weight: 800;
      color: #FFD600;
      margin-bottom: 12px;
      text-align: center;
    `;

    const avatarDescription = document.createElement('p');
    avatarDescription.textContent = 'Você tem um avatar exclusivo!';
    avatarDescription.style.cssText = `
      font-size: 1rem;
      color: #888888;
      line-height: 1.6;
      text-align: center;
    `;

    avatarCard.appendChild(avatarImageContainer);
    avatarCard.appendChild(avatarName);
    avatarCard.appendChild(avatarDescription);

    personaDebugLog('[ExclusivePersonaSystem] ✅ Avatar card assembled with', avatarCard.children.length, 'children');

    return avatarCard;
  }

  async triggerInterruption() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.id = 'exclusive-persona-overlay';
      overlay.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(10, 10, 10, 0.95);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.5s ease-out;
      `;

      const content = document.createElement('div');
      content.style.cssText = `
        max-width: 500px;
        padding: 40px;
        text-align: center;
      `;

      const splashMessage = document.createElement('div');
      splashMessage.style.cssText = `
        font-size: 2rem;
        font-weight: 800;
        color: var(--white);
        margin-bottom: 40px;
        opacity: 0;
        transform: translateY(20px);
        transition: opacity 0.6s ease-out, transform 0.6s ease-out;
      `;
      splashMessage.textContent = 'Pera ✋🏾 Temos algo especial para você.';

      const avatarCard = document.createElement('div');
      avatarCard.style.cssText = `
        background: var(--black-card);
        border: 2px solid var(--yellow);
        border-radius: var(--radius-xl);
        padding: 32px;
        box-shadow: 
          0 0 40px rgba(255, 214, 0, 0.3),
          0 0 80px rgba(255, 214, 0, 0.15);
        opacity: 0;
        transform: scale(0.9) translateY(30px);
        transition: opacity 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), 
                    transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
      `;

      const avatarImageContainer = document.createElement('div');
      avatarImageContainer.style.cssText = `
        width: 200px;
        height: 200px;
        margin: 0 auto 24px;
        border-radius: var(--radius-md);
        overflow: hidden;
        border: 2px solid var(--yellow);
        box-shadow: 0 0 20px rgba(255, 214, 0, 0.2);
      `;

      const avatarImage = document.createElement('img');
      avatarImage.src = this.baseAvatarUrl;
      avatarImage.alt = 'Seu avatar exclusivo';
      avatarImage.style.cssText = `
        width: 100%;
        height: 100%;
        object-fit: cover;
      `;

      avatarImageContainer.appendChild(avatarImage);

      const avatarName = document.createElement('h2');
      avatarName.style.cssText = `
        font-size: 1.75rem;
        font-weight: 800;
        color: var(--yellow);
        margin-bottom: 12px;
      `;
      avatarName.textContent = this.nickname;

      const avatarDescription = document.createElement('p');
      avatarDescription.style.cssText = `
        font-size: 1rem;
        color: var(--gray-light);
        line-height: 1.6;
      `;
      avatarDescription.textContent = 'Você tem um avatar exclusivo!';

      avatarCard.appendChild(avatarImageContainer);
      avatarCard.appendChild(avatarName);
      avatarCard.appendChild(avatarDescription);

        content.appendChild(splashMessage);
      content.appendChild(avatarCard);

        overlay.appendChild(content);
      document.body.appendChild(overlay);

      requestAnimationFrame(() => {
        overlay.style.opacity = '1';

        setTimeout(() => {
          splashMessage.style.opacity = '1';
          splashMessage.style.transform = 'translateY(0)';
        }, 300);

        setTimeout(() => {
          avatarCard.style.opacity = '1';
          avatarCard.style.transform = 'scale(1) translateY(0)';
        }, 800);

        setTimeout(() => {
          resolve();
        }, 2000);
      });
    });
  }

  async showGenerationAnimation() {
    return new Promise(async (resolve) => {
      const coolVersionResult = await this.checkCoolVersion();
      
      if (!coolVersionResult.exists) {
        resolve();
        return;
      }

      const overlay = document.getElementById('exclusive-persona-overlay');
      if (!overlay) {
        console.error('[ExclusivePersonaSystem] Overlay not found');
        resolve();
        return;
      }

      const content = overlay.querySelector('div');
      
      const generationCard = document.createElement('div');
      generationCard.style.cssText = `
        background: var(--black-card);
        border: 2px solid var(--yellow);
        border-radius: var(--radius-xl);
        padding: 40px;
        margin-top: 32px;
        box-shadow: 
          0 0 60px rgba(255, 214, 0, 0.4),
          0 0 120px rgba(255, 214, 0, 0.2);
        opacity: 0;
        transform: translateY(20px);
        transition: opacity 0.6s ease-out, transform 0.6s ease-out;
        position: relative;
        overflow: hidden;
      `;

      const glowEffect = document.createElement('div');
      glowEffect.style.cssText = `
        position: absolute;
        inset: -50%;
        background: radial-gradient(circle, rgba(255, 214, 0, 0.3), transparent 70%);
        animation: pulse 2s ease-in-out infinite;
      `;

      const particlesContainer = document.createElement('div');
      particlesContainer.style.cssText = `
        position: relative;
        width: 100%;
        height: 80px;
        margin-bottom: 20px;
      `;

      for (let i = 0; i < 8; i++) {
        const particle = document.createElement('div');
        particle.style.cssText = `
          position: absolute;
          width: 8px;
          height: 8px;
          background: var(--yellow);
          border-radius: 50%;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          animation: particle-${i} 1.5s ease-in-out infinite;
          animation-delay: ${i * 0.15}s;
        `;
        particlesContainer.appendChild(particle);
      }

      if (!document.getElementById('particle-animations')) {
        const style = document.createElement('style');
        style.id = 'particle-animations';
        style.textContent = `
          @keyframes pulse {
            0%, 100% { opacity: 0.3; transform: scale(1); }
            50% { opacity: 0.6; transform: scale(1.1); }
          }
          ${Array.from({ length: 8 }, (_, i) => {
            const angle = (i * 45) * (Math.PI / 180);
            const distance = 40;
            const x = Math.cos(angle) * distance;
            const y = Math.sin(angle) * distance;
            return `
              @keyframes particle-${i} {
                0%, 100% { transform: translate(-50%, -50%); opacity: 1; }
                50% { transform: translate(calc(-50% + ${x}px), calc(-50% + ${y}px)); opacity: 0.3; }
              }
            `;
          }).join('\n')}
        `;
        document.head.appendChild(style);
      }

      const generationMessage = document.createElement('p');
      generationMessage.style.cssText = `
        font-size: 1.1rem;
        font-weight: 600;
        color: var(--yellow);
        text-align: center;
        position: relative;
        z-index: 1;
      `;
      generationMessage.textContent = 'Sentury está gerando sua imagem...';

      generationCard.appendChild(glowEffect);
      generationCard.appendChild(particlesContainer);
      generationCard.appendChild(generationMessage);

      content.appendChild(generationCard);

      requestAnimationFrame(() => {
        generationCard.style.opacity = '1';
        generationCard.style.transform = 'translateY(0)';
      });

      const timeoutId = setTimeout(() => {
        console.warn('[ExclusivePersonaSystem] Cool version load timeout, using base avatar');
        resolve();
      }, 5000);

      const coolImage = new Image();
      coolImage.onload = () => {
        clearTimeout(timeoutId);

        const avatarImage = overlay.querySelector('img[alt="Seu avatar exclusivo"]');
        if (avatarImage) {
          avatarImage.style.transition = 'opacity 0.5s ease-out';
          avatarImage.style.opacity = '0';

          setTimeout(() => {
            avatarImage.src = this.coolAvatarUrl;
            avatarImage.style.opacity = '1';

            setTimeout(() => {
              generationCard.style.opacity = '0';
              generationCard.style.transform = 'translateY(20px)';

              setTimeout(() => {
                generationCard.remove();
                resolve();
              }, 600);
            }, 500);
          }, 500);
        } else {
          resolve();
        }
      };

      coolImage.onerror = () => {
        clearTimeout(timeoutId);
        console.error('[ExclusivePersonaSystem] Failed to load cool version');
        generationCard.remove();
        resolve();
      };

      coolImage.src = this.coolAvatarUrl;
    });
  }

  async showChoiceButtons() {
    return new Promise((resolve) => {
      if (!this.coolAvatarUrl) {
        this.selectedVariant = this.baseAvatarUrl.split('/').pop();
        try {
          localStorage.setItem('cx_invite_avatar_selection', this.selectedVariant);
        } catch (error) {
          console.warn('[ExclusivePersonaSystem] localStorage unavailable:', error);
        }
        resolve();
        return;
      }

      const overlay = document.getElementById('exclusive-persona-overlay');
      if (!overlay) {
        console.error('[ExclusivePersonaSystem] Overlay not found');
        resolve();
        return;
      }

      const content = overlay.querySelector('div');

      const logumMessageContainer = document.createElement('div');
      logumMessageContainer.style.cssText = `
        margin-top: 32px;
        text-align: center;
        opacity: 0;
        transform: translateY(20px);
        transition: opacity 0.6s ease-out, transform 0.6s ease-out;
      `;

      const logumMessage = document.createElement('p');
      logumMessage.style.cssText = `
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--white);
        margin-bottom: 24px;
      `;
      logumMessage.textContent = '😎 gostei… e você?';

      const choiceButtonsContainer = document.createElement('div');
      choiceButtonsContainer.style.cssText = `
        display: flex;
        gap: 16px;
        justify-content: center;
        flex-wrap: wrap;
      `;

      const withGlassesBtn = document.createElement('button');
      withGlassesBtn.type = 'button';
      withGlassesBtn.style.cssText = `
        padding: 16px 32px;
        background: var(--yellow);
        border: 2px solid var(--yellow);
        border-radius: var(--radius-md);
        color: var(--black);
        font-family: var(--font);
        font-size: 1rem;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        box-shadow: 0 4px 16px rgba(255, 214, 0, 0.3);
      `;
      withGlassesBtn.textContent = '😎 Com óculos';

      const withoutGlassesBtn = document.createElement('button');
      withoutGlassesBtn.type = 'button';
      withoutGlassesBtn.style.cssText = `
        padding: 16px 32px;
        background: transparent;
        border: 2px solid var(--yellow);
        border-radius: var(--radius-md);
        color: var(--yellow);
        font-family: var(--font);
        font-size: 1rem;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      `;
      withoutGlassesBtn.textContent = '🙂 Sem óculos';

      withGlassesBtn.addEventListener('mouseenter', () => {
        withGlassesBtn.style.transform = 'translateY(-2px) scale(1.05)';
        withGlassesBtn.style.boxShadow = '0 6px 24px rgba(255, 214, 0, 0.4)';
      });
      withGlassesBtn.addEventListener('mouseleave', () => {
        withGlassesBtn.style.transform = 'translateY(0) scale(1)';
        withGlassesBtn.style.boxShadow = '0 4px 16px rgba(255, 214, 0, 0.3)';
      });

      withoutGlassesBtn.addEventListener('mouseenter', () => {
        withoutGlassesBtn.style.transform = 'translateY(-2px) scale(1.05)';
        withoutGlassesBtn.style.background = 'rgba(255, 214, 0, 0.1)';
      });
      withoutGlassesBtn.addEventListener('mouseleave', () => {
        withoutGlassesBtn.style.transform = 'translateY(0) scale(1)';
        withoutGlassesBtn.style.background = 'transparent';
      });

      // Trata a seleção de "Com óculos"
      withGlassesBtn.addEventListener('click', () => {
        this.selectedVariant = this.coolAvatarUrl.split('/').pop();
        try {
          localStorage.setItem('cx_invite_avatar_selection', this.selectedVariant);
          personaDebugLog('[ExclusivePersonaSystem] Selected cool version:', this.selectedVariant);
        } catch (error) {
          console.warn('[ExclusivePersonaSystem] localStorage unavailable:', error);
        }

        // Anima a seleção do botão
        withGlassesBtn.style.transform = 'scale(0.95)';
        setTimeout(() => {
          // Efeito de fade out no overlay
          overlay.style.opacity = '0';
          setTimeout(() => {
            overlay.remove();
            resolve();
          }, 500);
        }, 200);
      });

      // Trata a seleção de "Sem óculos"
      withoutGlassesBtn.addEventListener('click', () => {
        this.selectedVariant = this.baseAvatarUrl.split('/').pop();
        try {
          localStorage.setItem('cx_invite_avatar_selection', this.selectedVariant);
          personaDebugLog('[ExclusivePersonaSystem] Selected base version:', this.selectedVariant);
        } catch (error) {
          console.warn('[ExclusivePersonaSystem] localStorage unavailable:', error);
        }

        // Anima a seleção do botão
        withoutGlassesBtn.style.transform = 'scale(0.95)';
        setTimeout(() => {
          // Efeito de fade out no overlay
          overlay.style.opacity = '0';
          setTimeout(() => {
            overlay.remove();
            resolve();
          }, 500);
        }, 200);
      });

      choiceButtonsContainer.appendChild(withGlassesBtn);
      choiceButtonsContainer.appendChild(withoutGlassesBtn);
      logumMessageContainer.appendChild(logumMessage);
      logumMessageContainer.appendChild(choiceButtonsContainer);

      content.appendChild(logumMessageContainer);

      requestAnimationFrame(() => {
        logumMessageContainer.style.opacity = '1';
        logumMessageContainer.style.transform = 'translateY(0)';
      });
    });
  }

  renderConfirmationButton(onConfirm) {
    personaDebugLog('[ExclusivePersonaSystem] 🔘 Rendering confirmation button...');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'exclusive-confirm-button';
    button.textContent = 'Confirmar';

    button.setAttribute('aria-label', 'Confirmar e continuar com avatar exclusivo');
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '0');

    button.addEventListener('click', () => {
      personaDebugLog('[ExclusivePersonaSystem] 🖱️ Button clicked!');
      if (typeof onConfirm === 'function') {
        onConfirm();
      }
    });

    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (typeof onConfirm === 'function') {
          onConfirm();
        }
      }
    });

    personaDebugLog('[ExclusivePersonaSystem] ✅ Button ready with event listeners attached');
    return button;
  }

  saveSelection(variant) {
    if (!variant || (variant !== 'cool' && variant !== 'base')) {
      throw new Error(`Invalid variant: ${variant}. Must be 'cool' or 'base'.`);
    }

    let filename = null;

    if (variant === 'cool') {
      if (this.coolAvatarUrl) {
        filename = this.coolAvatarUrl.split('/').pop();
      } else {
        throw new Error('Cool avatar URL not available. Cannot save cool variant.');
      }
    } else if (variant === 'base') {
      if (this.baseAvatarUrl) {
        filename = this.baseAvatarUrl.split('/').pop();
      } else {
        throw new Error('Base avatar URL not available. Cannot save base variant.');
      }
    }

    if (!filename || filename.trim() === '') {
      throw new Error(`Invalid filename determined for variant '${variant}': ${filename}`);
    }

    this.selectedVariant = filename;

    try {
      localStorage.setItem('cx_invite_avatar_selection', filename);
      personaDebugLog(`[ExclusivePersonaSystem] Saved ${variant} avatar selection:`, filename);
    } catch (error) {
      // localStorage unavailable — selection is stored in this.selectedVariant and
      // will be read via getSelectedAvatar() during form submission
      console.warn('[ExclusivePersonaSystem] localStorage unavailable, selection stored in memory only:', error);
    }

    return filename;
  }

  renderChoiceButtons(onChoice) {
    let currentSelection = 'cool';

    const container = document.createElement('div');
    container.className = 'exclusive-choice-buttons';

    container.setAttribute('role', 'group');
    container.setAttribute('aria-label', 'Escolha a variante do seu avatar');
    
    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.cssText = `
      display: flex;
      gap: 16px;
      justify-content: center;
      margin-bottom: 24px;
    `;
    
    const coolButton = document.createElement('button');
    coolButton.type = 'button';
    coolButton.className = 'exclusive-choice-button active';
    coolButton.textContent = '😎 Com óculos';
    coolButton.style.cssText = `
      padding: 16px 32px;
      background: var(--yellow);
      border: 2px solid var(--yellow);
      border-radius: var(--radius-md);
      color: var(--black);
      font-family: var(--font);
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      box-shadow: 0 4px 16px rgba(255, 214, 0, 0.3);
    `;
    
    coolButton.setAttribute('aria-label', 'Escolher avatar com óculos');
    coolButton.setAttribute('aria-pressed', 'true');
    coolButton.setAttribute('tabindex', '0');
    
    const baseButton = document.createElement('button');
    baseButton.type = 'button';
    baseButton.className = 'exclusive-choice-button secondary';
    baseButton.textContent = '🙂 Sem óculos';
    baseButton.style.cssText = `
      padding: 16px 32px;
      background: transparent;
      border: 2px solid var(--yellow);
      border-radius: var(--radius-md);
      color: var(--yellow);
      font-family: var(--font);
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    `;
    
    baseButton.setAttribute('aria-label', 'Escolher avatar sem óculos');
    baseButton.setAttribute('aria-pressed', 'false');
    baseButton.setAttribute('tabindex', '0');

    const updateButtonStates = (selected) => {
      if (selected === 'cool') {
        coolButton.style.background = 'var(--yellow)';
        coolButton.style.color = 'var(--black)';
        coolButton.style.boxShadow = '0 4px 16px rgba(255, 214, 0, 0.3)';
        coolButton.setAttribute('aria-pressed', 'true');
        
        baseButton.style.background = 'transparent';
        baseButton.style.color = 'var(--yellow)';
        baseButton.style.boxShadow = 'none';
        baseButton.setAttribute('aria-pressed', 'false');
      } else {
        baseButton.style.background = 'var(--yellow)';
        baseButton.style.color = 'var(--black)';
        baseButton.style.boxShadow = '0 4px 16px rgba(255, 214, 0, 0.3)';
        baseButton.setAttribute('aria-pressed', 'true');
        
        coolButton.style.background = 'transparent';
        coolButton.style.color = 'var(--yellow)';
        coolButton.style.boxShadow = 'none';
        coolButton.setAttribute('aria-pressed', 'false');
      }
    };
    
    const switchAvatarPreview = (variant) => {
      const overlay = document.getElementById('exclusive-persona-overlay');
      if (!overlay) return;

      const avatarImage = overlay.querySelector('[data-exclusive-avatar-card="true"] img');
      if (!avatarImage) return;

      avatarImage.style.transition = 'opacity 0.3s ease-out';
      avatarImage.style.opacity = '0';

      setTimeout(() => {
        avatarImage.src = variant === 'cool' ? this.coolAvatarUrl : this.baseAvatarUrl;
        avatarImage.style.opacity = '1';
      }, 300);
    };

    coolButton.addEventListener('click', () => {
      if (currentSelection !== 'cool') {
        currentSelection = 'cool';
        updateButtonStates('cool');
        switchAvatarPreview('cool');
      }
    });
    
    baseButton.addEventListener('click', () => {
      if (currentSelection !== 'base') {
        currentSelection = 'base';
        updateButtonStates('base');
        switchAvatarPreview('base');
      }
    });
    
    coolButton.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (currentSelection !== 'cool') {
          currentSelection = 'cool';
          updateButtonStates('cool');
          switchAvatarPreview('cool');
        }
      }
    });
    
    baseButton.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (currentSelection !== 'base') {
          currentSelection = 'base';
          updateButtonStates('base');
          switchAvatarPreview('base');
        }
      }
    });
    
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'exclusive-confirm-choice-button';
    confirmButton.textContent = 'Confirmar';
    confirmButton.style.cssText = `
      padding: 16px 48px;
      background: var(--yellow);
      border: 2px solid var(--yellow);
      border-radius: var(--radius-md);
      color: var(--black);
      font-family: var(--font);
      font-size: 1.1rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      box-shadow: 0 6px 20px rgba(255, 214, 0, 0.4);
      display: block;
      margin: 0 auto;
    `;
    
    confirmButton.setAttribute('aria-label', 'Confirmar escolha do avatar');
    confirmButton.setAttribute('tabindex', '0');

    confirmButton.addEventListener('click', () => {
      if (typeof onChoice === 'function') {
        onChoice(currentSelection);
      }
    });
    
    confirmButton.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (typeof onChoice === 'function') {
          onChoice(currentSelection);
        }
      }
    });
    
    confirmButton.addEventListener('mouseenter', () => {
      confirmButton.style.transform = 'translateY(-2px) scale(1.05)';
      confirmButton.style.boxShadow = '0 8px 28px rgba(255, 214, 0, 0.5)';
    });
    confirmButton.addEventListener('mouseleave', () => {
      confirmButton.style.transform = 'translateY(0) scale(1)';
      confirmButton.style.boxShadow = '0 6px 20px rgba(255, 214, 0, 0.4)';
    });
    
    buttonsContainer.appendChild(coolButton);
    buttonsContainer.appendChild(baseButton);
    container.appendChild(buttonsContainer);
    container.appendChild(confirmButton);
    
    return container;
  }

  renderGenerationAnimation() {
    const generationOverlay = document.createElement('div');
    generationOverlay.className = 'generation-animation-overlay';

    const glowEffect = document.createElement('div');
    glowEffect.className = 'generation-glow';

    const particlesContainer = document.createElement('div');
    particlesContainer.className = 'generation-particles';

    for (let i = 0; i < 8; i++) {
      const particle = document.createElement('div');
      particle.className = 'generation-particle';
      particle.style.cssText = `
        position: absolute;
        width: 8px;
        height: 8px;
        background: var(--yellow);
        border-radius: 50%;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        animation: particle-${i} 1.5s ease-in-out infinite;
        animation-delay: ${i * 0.15}s;
      `;
      particlesContainer.appendChild(particle);
    }

    const generationMessage = document.createElement('div');
    generationMessage.className = 'generation-message';
    generationMessage.textContent = 'Sentury está gerando sua imagem...';

    generationOverlay.appendChild(glowEffect);
    generationOverlay.appendChild(particlesContainer);
    generationOverlay.appendChild(generationMessage);

    return generationOverlay;
  }

  async renderCoolAvatarTransition() {
    return new Promise((resolve, reject) => {
      const overlay = document.getElementById('exclusive-persona-overlay');
      if (!overlay) {
        console.error('[ExclusivePersonaSystem] Overlay not found for cool avatar transition');
        reject(new Error('Overlay not found'));
        return;
      }

      const avatarImage = overlay.querySelector('img[alt="Seu avatar exclusivo"]');
      if (!avatarImage) {
        console.error('[ExclusivePersonaSystem] Avatar image not found for cool avatar transition');
        reject(new Error('Avatar image not found'));
        return;
      }

      if (!this.coolAvatarUrl) {
        console.error('[ExclusivePersonaSystem] Cool avatar URL not available');
        reject(new Error('Cool avatar URL not available'));
        return;
      }

      const coolImage = new Image();

      coolImage.onload = () => {
        avatarImage.style.transition = 'opacity 0.6s ease-out';
        avatarImage.style.opacity = '0';

        setTimeout(() => {
          avatarImage.src = this.coolAvatarUrl;

          requestAnimationFrame(() => {
            avatarImage.style.opacity = '1';
          });

          setTimeout(() => {
            personaDebugLog('[ExclusivePersonaSystem] Cool avatar transition complete');
            resolve();
          }, 600);
        }, 300);
      };

      coolImage.onerror = () => {
        console.error('[ExclusivePersonaSystem] Failed to load cool avatar for transition');
        reject(new Error('Failed to load cool avatar'));
      };

      coolImage.src = this.coolAvatarUrl;
    });
  }

  getSelectedAvatar() {
    return this.selectedVariant;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExclusivePersonaSystem;
}

if (typeof window !== 'undefined') {
  window.ExclusivePersonaSystem = ExclusivePersonaSystem;
}
