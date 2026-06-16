
(function initKeyboardNavigation(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.KeyboardNavigation = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function buildKeyboardNavigation(root) {
  let usingKeyboard = false;
  
  function init() {
    root.document.addEventListener('keydown', handleKeyDown);
    root.document.addEventListener('mousedown', handleMouseDown);
    root.document.addEventListener('keydown', handleEscapeKey);
    root.document.addEventListener('keydown', handleButtonActivation);
  }
  
  function handleKeyDown(event) {
    if (event.key === 'Tab') {
      usingKeyboard = true;
      root.document.body.classList.add('using-keyboard');
    }
  }
  
  function handleMouseDown(event) {
    usingKeyboard = false;
    root.document.body.classList.remove('using-keyboard');
  }
  
  function handleEscapeKey(event) {
    if (event.key === 'Escape' || event.key === 'Esc') {
      const overlays = [
        root.document.getElementById('intermission-how-overlay'),
        root.document.querySelector('.intermission-how-overlay.show'),
        root.document.querySelector('.modal.show'),
        root.document.querySelector('.overlay.show')
      ];
      
      overlays.forEach(overlay => {
        if (overlay && overlay.classList.contains('show')) {
          overlay.classList.remove('show');
          overlay.setAttribute('aria-hidden', 'true');

          const closeBtn = overlay.querySelector('[id*="close"], .close-btn, .modal-close');
          if (closeBtn) {
            closeBtn.click();
          }

          event.preventDefault();
          event.stopPropagation();
        }
      });
    }
  }
  
  function handleButtonActivation(event) {
    const target = event.target;
    
    const isButton = target.tagName === 'BUTTON' || 
                     target.getAttribute('role') === 'button' ||
                     target.classList.contains('intermission-btn') ||
                     target.classList.contains('ig-btn') ||
                     target.classList.contains('hint-btn') ||
                     target.classList.contains('result-btn-primary') ||
                     target.classList.contains('intermission-seq-step') ||
                     target.classList.contains('intermission-tile-btn') ||
                     target.classList.contains('intermission-profile-btn');
    
    if (!isButton) {
      return;
    }
    
    if (target.disabled || target.hasAttribute('disabled')) {
      return;
    }

    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      if (event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
      }

      target.click();
      
      target.classList.add('keyboard-activated');
      setTimeout(() => {
        target.classList.remove('keyboard-activated');
      }, 150);
    }
  }
  
  function makeAccessible(element, options = {}) {
    if (!element) {
      return;
    }
    
    const {
      role = 'button',
      tabindex = 0,
      label = null
    } = options;
    
    if (!element.hasAttribute('role')) {
      element.setAttribute('role', role);
    }
    
    if (!element.hasAttribute('tabindex')) {
      element.setAttribute('tabindex', tabindex);
    }
    
    if (label && !element.hasAttribute('aria-label')) {
      element.setAttribute('aria-label', label);
    }
  }
  
  function setupGameNavigation(gameType) {
    const buttons = root.document.querySelectorAll(
      'button, .intermission-btn, .ig-btn, .hint-btn, .result-btn-primary, ' +
      '.intermission-seq-step, .intermission-tile-btn, .intermission-profile-btn'
    );
    
    buttons.forEach(button => {
      if (!button.hasAttribute('tabindex') && button.getAttribute('tabindex') !== '-1') {
        button.setAttribute('tabindex', '0');
      }
      
      if (!button.hasAttribute('role') && button.tagName !== 'BUTTON') {
        button.setAttribute('role', 'button');
      }
    });
    
    switch (gameType) {
      case 'termo-cx':
        setupTermoNavigation();
        break;
      case 'sequencia-cx':
        setupSequenciaNavigation();
        break;
      case 'conexo-cx':
        setupConexoNavigation();
        break;
      case 'quem-disse-cx':
        setupQuemDisseNavigation();
        break;
    }
  }
  
  function setupTermoNavigation() {
    const input = root.document.getElementById('intermission-termo-input');
    const submitBtn = root.document.getElementById('intermission-termo-submit');
    
    if (input) {
      if (!input.hasAttribute('tabindex')) {
        input.setAttribute('tabindex', '0');
      }
    }
    
    if (submitBtn) {
      makeAccessible(submitBtn, { label: 'Enviar palavra' });
    }
  }
  
  function setupSequenciaNavigation() {
    const steps = root.document.querySelectorAll('.intermission-seq-step');
    
    steps.forEach((step, index) => {
      makeAccessible(step, {
        label: `Etapa ${index + 1}: ${step.textContent.trim()}`
      });
    });
  }
  
  function setupConexoNavigation() {
    const tiles = root.document.querySelectorAll('.intermission-tile-btn');
    
    tiles.forEach((tile, index) => {
      makeAccessible(tile, {
        label: `Palavra: ${tile.textContent.trim()}`
      });
    });
  }
  
  function setupQuemDisseNavigation() {
    const profiles = root.document.querySelectorAll('.intermission-profile-btn');
    
    profiles.forEach((profile, index) => {
      makeAccessible(profile, {
        label: `Perfil: ${profile.textContent.trim()}`
      });
    });
  }
  
  function focusFirst(container) {
    const containerEl = typeof container === 'string' 
      ? root.document.querySelector(container)
      : container;
    
    if (!containerEl) {
      return;
    }
    
    const focusable = containerEl.querySelector(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), ' +
      'textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    );
    
    if (focusable) {
      focusable.focus();
    }
  }
  
  function trapFocus(modal) {
    if (!modal) {
      return;
    }
    
    const focusableElements = modal.querySelectorAll(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), ' +
      'textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    );
    
    if (focusableElements.length === 0) {
      return;
    }
    
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    
    const handleTab = (event) => {
      if (event.key !== 'Tab') {
        return;
      }
      
      if (event.shiftKey) {
        if (root.document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        }
      } else {
        if (root.document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    };
    
    modal.addEventListener('keydown', handleTab);
    
    // Focus first element
    firstElement.focus();
    
    return () => {
      modal.removeEventListener('keydown', handleTab);
    };
  }
  
  function isUsingKeyboard() {
    return usingKeyboard;
  }
  
  // Public API
  return {
    init,
    makeAccessible,
    setupGameNavigation,
    focusFirst,
    trapFocus,
    isUsingKeyboard
  };
});
