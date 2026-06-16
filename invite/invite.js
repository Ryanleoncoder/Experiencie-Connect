function inviteDebugLog(...args) {
  if (typeof window !== 'undefined' && window.CX_DEBUG === true) {
    console.debug(...args);
  }
}

inviteDebugLog('[INVITE.JS] Script loaded at:', new Date().toISOString());

const INVITE_AML_SYMBOLS = {
  ec:    '<text x="14" y="19" font-family="DM Sans" font-weight="800" font-size="13" fill="currentColor" stroke="none" text-anchor="middle" class="aml-letters">EC</text>',
  plane: '<path d="M3 14 L25 4 L17 24 L13 16 Z" class="aml-draw" style="--len:62"/><line x1="13" y1="16" x2="17" y2="13" class="aml-draw" style="--len:5"/>',
  check: '<polyline points="6,14.5 12,20 22,8" class="aml-draw" style="--len:26"/>'
};
const INVITE_AML_SPARK = '<svg class="aml-spark" viewBox="0 0 28 28"><line x1="14" y1="1" x2="14" y2="4"/><line x1="14" y1="24" x2="14" y2="27"/><line x1="1" y1="14" x2="4" y2="14"/><line x1="24" y1="14" x2="27" y2="14"/><line x1="5" y1="5" x2="7" y2="7"/><line x1="21" y1="21" x2="23" y2="23"/><line x1="23" y1="5" x2="21" y2="7"/><line x1="7" y1="21" x2="5" y2="23"/></svg>';

let _inviteAmlGen = 0;

function inviteAmlDrawOne(stage, sym, onDone) {
  const gen = _inviteAmlGen;
  stage.innerHTML =
    '<div style="position:relative;width:28px;height:28px">' +
    '<svg class="aml-sym" viewBox="0 0 28 28">' + INVITE_AML_SYMBOLS[sym] + '</svg>' +
    INVITE_AML_SPARK + '</div>';
  const wrap = stage.firstChild;
  const svg = wrap.querySelector('.aml-sym');
  const spark = wrap.querySelector('.aml-spark');
  setTimeout(() => {
    if (_inviteAmlGen !== gen) return;
    svg.classList.add('aml-pulse');
    if (spark) spark.classList.add('on');
    setTimeout(() => {
      if (_inviteAmlGen !== gen) return;
      onDone();
    }, 360);
  }, 420);
}

function startInviteAml(stage, flow) {
  _inviteAmlGen++;
  const gen = _inviteAmlGen;
  let idx = 0;
  function step() {
    if (_inviteAmlGen !== gen) return;
    inviteAmlDrawOne(stage, flow[idx % flow.length], step);
    idx++;
  }
  step();
}

function stopInviteAml() {
  _inviteAmlGen++;
}

let currentStep = 1;
let inviteData = {
  token: null,
  code: null,
  password: null,
  avatar: null
};

function goToStep(step) {
  if (step < 1 || step > 3) return;
  
  document.querySelectorAll('.step-content').forEach(content => {
    content.classList.remove('active');
  });
  
  const targetContent = document.getElementById(`step-${step}`);
  if (targetContent) {
    targetContent.classList.add('active');
  }
  
  document.querySelectorAll('.step').forEach((stepEl, index) => {
    const stepNum = index + 1;
    stepEl.classList.remove('active', 'completed');
    
    if (stepNum === step) {
      stepEl.classList.add('active');
    } else if (stepNum < step) {
      stepEl.classList.add('completed');
    }
  });
  
  currentStep = step;
  
  setTimeout(() => {
    const firstInput = targetContent.querySelector('input:not([type="hidden"])');
    if (firstInput) {
      firstInput.focus();
    }
  }, 100);
}

const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get('token');

const states = {
  loading: document.getElementById('loading-state'),
  error: document.getElementById('error-state'),
  form: document.getElementById('form-state'),
  success: document.getElementById('success-state')
};

function togglePasswordVisibility(inputId) {
  const input = document.getElementById(inputId);
  const button = input.parentElement.querySelector('.toggle-password');
  const eyeOpen = button.querySelector('.eye-open');
  const eyeClosed = button.querySelector('.eye-closed');

  if (input.type === 'password') {
    input.type = 'text';
    eyeOpen.style.display = 'none';
    eyeClosed.style.display = 'block';
  } else {
    input.type = 'password';
    eyeOpen.style.display = 'block';
    eyeClosed.style.display = 'none';
  }
}

function checkPasswordStrength(password) {
  const strengthIndicator = document.getElementById('password-strength');
  const strengthBar = document.getElementById('strength-bar-fill');
  const strengthText = document.getElementById('strength-text');
  const requirementsDiv = document.getElementById('password-requirements');

  if (!password || password.length === 0) {
    strengthIndicator.classList.add('hidden');
    requirementsDiv.classList.add('hidden');
    
    strengthBar.style.width = '0%';
    strengthBar.className = 'strength-bar-fill';
    strengthText.textContent = '';
    
    ['req-length', 'req-uppercase', 'req-lowercase', 'req-special'].forEach(reqId => {
      const reqElement = document.getElementById(reqId);
      if (reqElement) {
        reqElement.classList.remove('met');
        const icon = reqElement.querySelector('.req-icon');
        if (icon) icon.textContent = '○';
      }
    });
    
    return;
  }

  strengthIndicator.classList.remove('hidden');
  requirementsDiv.classList.remove('hidden');

  const hasLength = password.length >= 6;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasSpecial = /[#@%$!&*]/.test(password);
  const allMet = hasLength && hasUppercase && hasLowercase && hasSpecial;

  updateRequirement('req-length', hasLength);
  updateRequirement('req-uppercase', hasUppercase);
  updateRequirement('req-lowercase', hasLowercase);
  updateRequirement('req-special', hasSpecial);

  clearTimeout(window._pwReqDismissTimer);
  if (allMet) {
    window._pwReqDismissTimer = setTimeout(() => {
      requirementsDiv.classList.add('hidden');
    }, 500);
  }

  let strength = 0;
  if (hasLength) strength += 1;
  if (hasUppercase) strength += 1;
  if (hasLowercase) strength += 1;
  if (hasSpecial) strength += 1;

  if (password.length >= 8) strength += 0.5;
  if (password.length >= 12) strength += 0.5;

  if (/^[0-9]+$/.test(password)) strength -= 1;
  if (/(.)\1{2,}/.test(password)) strength -= 0.5;

  strength = Math.max(0, Math.min(4, strength));

  strengthBar.className = 'strength-bar-fill';
  
  if (strength < 2) {
    strengthBar.classList.add('weak');
    strengthBar.style.width = '25%';
    strengthText.textContent = 'Senha fraca';
    strengthText.style.color = '#ff4444';
  } else if (strength < 3) {
    strengthBar.classList.add('medium');
    strengthBar.style.width = '50%';
    strengthText.textContent = 'Senha média';
    strengthText.style.color = '#ffaa00';
  } else if (strength < 4) {
    strengthBar.classList.add('good');
    strengthBar.style.width = '75%';
    strengthText.textContent = 'Senha boa';
    strengthText.style.color = '#88cc00';
  } else {
    strengthBar.classList.add('strong');
    strengthBar.style.width = '100%';
    strengthText.textContent = 'Senha forte';
    strengthText.style.color = '#00cc66';
  }
}

function updateRequirement(reqId, isMet) {
  const reqElement = document.getElementById(reqId);
  const icon = reqElement.querySelector('.req-icon');
  
  if (isMet) {
    reqElement.classList.add('met');
    icon.textContent = '✓';
  } else {
    reqElement.classList.remove('met');
    icon.textContent = '○';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const passwordInput = document.getElementById('password');
  if (passwordInput) {
    passwordInput.addEventListener('input', (e) => {
      clearTimeout(window._pwReqDismissTimer);
      clearTimeout(window._pwReqIdleTimer);
      checkPasswordStrength(e.target.value);
      if (e.target.value.length > 0) {
        window._pwReqIdleTimer = setTimeout(() => {
          const requirementsDiv = document.getElementById('password-requirements');
          if (requirementsDiv) requirementsDiv.classList.add('hidden');
        }, 2500);
      }
    });
    passwordInput.addEventListener('blur', () => {
      clearTimeout(window._pwReqDismissTimer);
      clearTimeout(window._pwReqIdleTimer);
      const requirementsDiv = document.getElementById('password-requirements');
      if (requirementsDiv) requirementsDiv.classList.add('hidden');
    });
    passwordInput.addEventListener('focus', () => {
      clearTimeout(window._pwReqDismissTimer);
      clearTimeout(window._pwReqIdleTimer);
      if (passwordInput.value.length > 0) {
        const allMet = ['req-length', 'req-uppercase', 'req-lowercase', 'req-special']
          .every(id => document.getElementById(id)?.classList.contains('met'));
        const requirementsDiv = document.getElementById('password-requirements');
        if (requirementsDiv && !allMet) requirementsDiv.classList.remove('hidden');
      }
    });
  }
});

function showState(stateName) {
  Object.values(states).forEach(el => el.classList.add('hidden'));
  states[stateName].classList.remove('hidden');
}

async function validateInvite() {
  if (!token) {
    showError('Link de convite inválido. Verifique o link recebido.');
    return;
  }

  try {
    const response = await fetch(`/api/check-invite?token=${token}`, { signal: AbortSignal.timeout(8000) });
    let data;
    try { data = await response.json(); } catch { data = {}; }

    if (response.ok && data.valid) {
      document.getElementById('nickname-display').textContent = data.nickname;
      currentNickname = data.nickname;
      
      inviteData.token = token;
      
      showState('form');
      goToStep(1);
      
      return;
    }

    if (response.status === 404) {
      showError('Convite Inválido', data.error || 'Convite não encontrado. Verifique o link recebido.');
    } else if (response.status === 410) {
      showError('Convite Já Utilizado', data.error || 'Este convite já foi usado e não pode ser reutilizado.');
    } else if (response.status === 403) {
      showError('Convite Bloqueado', data.error || 'Este convite foi bloqueado.');
    } else {
      showError('Erro no Convite', data.error || 'Convite inválido');
    }
  } catch (error) {
    console.error('validateInvite error:', error);
    showError('Erro de conexão. Verifique sua internet e tente novamente.');
  }
}

function showError(title, message) {
  if (!message) {
    message = title;
    title = 'Convite Inválido';
  }
  
  document.getElementById('error-message').textContent = message;
  
  const titleEl = document.querySelector('#error-state .error-title');
  if (titleEl) {
    titleEl.textContent = title;
  }
  
  showState('error');
}

function showFormError(message) {
  const errorEl = document.getElementById('form-error');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
}

function hideFormError() {
  const errorEl = document.getElementById('form-error');
  errorEl.classList.add('hidden');
}

async function preloadAvatarImages() {
  try {
    const response = await fetch('/api/accept-invite', { signal: AbortSignal.timeout(8000) });

    if (!response.ok) return;

    const data = await response.json();

    if (!data.success || !Array.isArray(data.avatars)) return;

    const preloadPromises = data.avatars.map(filename => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = resolve;
        img.onerror = resolve;
        img.src = `/frontend/assets/image/avatar/${filename}`;
      });
    });

    await Promise.all(preloadPromises);

  } catch (error) {
    console.error('[Preload] Error preloading avatars:', error);
  }
}

const inviteCodeInput = document.getElementById('invite-code');
inviteCodeInput.addEventListener('input', () => {
  inviteCodeInput.classList.remove('input-error');
  document.getElementById('code-error').classList.add('hidden');
});

document.getElementById('code-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const codeError = document.getElementById('code-error');
  codeError.classList.add('hidden');
  inviteCodeInput.classList.remove('input-error');

  const inviteCode = inviteCodeInput.value.trim();

  if (!inviteCode) {
    codeError.textContent = 'O campo não pode ficar vazio.';
    codeError.classList.remove('hidden');
    inviteCodeInput.classList.add('input-error');
    inviteCodeInput.focus();
    return;
  }
  
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalBtnText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Validando...';
  
  try {
    const response = await fetch('/api/validate-invite-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, invite_code: inviteCode }),
      signal: AbortSignal.timeout(8000)
    });
    
    let data;
    try { data = await response.json(); } catch { data = {}; }

    if (!response.ok || !data.valid) {
      console.error('[Form] Invalid invite code');

      let errorMessage = data.error || 'Código de convite incorreto. Verifique o código recebido.';
      if (data.attempts_left !== undefined && data.attempts_left > 0) {
        errorMessage += ` (${data.attempts_left} tentativas restantes)`;
      }
      
      codeError.textContent = errorMessage;
      codeError.classList.remove('hidden');
      inviteCodeInput.classList.add('input-error');

      submitBtn.disabled = false;
      submitBtn.textContent = originalBtnText;
      return;
    }

    inviteDebugLog('[Form] ✅ Invite code validated successfully');
    inviteData.code = inviteCode;

    const usernameHint = document.getElementById('username-hint');
    if (usernameHint && currentNickname) usernameHint.value = currentNickname;

    goToStep(2);

    preloadAvatarImages().catch(err => {
      console.warn('[Preload] Background preload failed:', err);
    });

  } catch (error) {
    console.error('[Form] Error validating code:', error);
    codeError.textContent = error.name === 'TimeoutError'
      ? 'Tempo de resposta excedido. Verifique sua conexão e tente novamente.'
      : 'Erro ao validar código. Verifique sua conexão e tente novamente.';
    codeError.classList.remove('hidden');
    inviteCodeInput.classList.add('input-error');

    submitBtn.disabled = false;
    submitBtn.textContent = originalBtnText;
    return;
  }
});

const passwordInput = document.getElementById('password');
const confirmPasswordInput = document.getElementById('confirm-password');

[passwordInput, confirmPasswordInput].forEach(input => {
  input.addEventListener('input', () => {
    input.classList.remove('input-error');
    document.getElementById('password-error').classList.add('hidden');
  });
});

document.getElementById('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const passwordError = document.getElementById('password-error');
  passwordError.classList.add('hidden');
  passwordInput.classList.remove('input-error');
  confirmPasswordInput.classList.remove('input-error');

  const password = passwordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  function showPwError(msg, input) {
    passwordError.textContent = msg;
    passwordError.classList.remove('hidden');
    if (input) { input.classList.add('input-error'); input.focus(); }
  }

  if (!password) {
    showPwError('O campo não pode ficar vazio.', passwordInput);
    return;
  }

  if (password.length < 6) {
    showPwError('A senha deve ter no mínimo 6 caracteres.', passwordInput);
    return;
  }

  if (inviteData.code && password.toUpperCase() === inviteData.code.toUpperCase()) {
    showPwError('A senha não pode ser igual ao código de convite.', passwordInput);
    return;
  }

  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasSpecial = /[#@%$!&*]/.test(password);

  if (!hasUppercase) {
    showPwError('A senha deve conter pelo menos 1 letra maiúscula.', passwordInput);
    return;
  }

  if (!hasLowercase) {
    showPwError('A senha deve conter pelo menos 1 letra minúscula.', passwordInput);
    return;
  }

  if (!hasSpecial) {
    showPwError('A senha deve conter pelo menos 1 caractere especial (#@%$!&*).', passwordInput);
    return;
  }

  if (!confirmPassword) {
    showPwError('Confirme sua senha.', confirmPasswordInput);
    return;
  }

  if (password !== confirmPassword) {
    showPwError('As senhas não coincidem.', confirmPasswordInput);
    return;
  }
  
  inviteData.password = password;
  goToStep(3);

  if (currentNickname && !avatarSelector) {
    const finishBtn = document.getElementById('finish-btn');
    if (finishBtn) {
      finishBtn.disabled = true;
      finishBtn.style.opacity = '0.5';
      finishBtn.style.cursor = 'not-allowed';
      finishBtn.title = 'Selecione um avatar primeiro';
    }

    await initializeAvatarSystem(currentNickname);
  }
});

document.getElementById('finish-btn').addEventListener('click', async (e) => {
  e.preventDefault();
  
  const avatarError = document.getElementById('avatar-error');
  avatarError.classList.add('hidden');
  
  let selectedAvatar = null;
  if (avatarSelector) {
    selectedAvatar = avatarSelector.getSelectedAvatar();
  }

  if (!selectedAvatar) {
    try {
      selectedAvatar = localStorage.getItem('cx_invite_avatar_selection');
    } catch (error) {
      console.warn('[Form] localStorage unavailable:', error);
    }
  }

  if (!selectedAvatar && exclusivePersonaSystem) {
    selectedAvatar = exclusivePersonaSystem.getSelectedAvatar();
  }

  if (!selectedAvatar && inviteData.avatar) {
    selectedAvatar = inviteData.avatar;
  }

  if (!selectedAvatar) {
    avatarError.textContent = 'Por favor, selecione um avatar antes de continuar.';
    avatarError.classList.remove('hidden');
    return;
  }
  
  const website = document.getElementById('website').value;

  const finishBtn = document.getElementById('finish-btn');
  const amlStage = finishBtn.querySelector('.aml-stage');

  finishBtn.disabled = true;
  finishBtn.classList.add('loading');
  startInviteAml(amlStage, ['ec', 'plane']);

  try {
    const response = await fetch('/api/accept-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        invite_code: inviteData.code,
        password: inviteData.password,
        avatar_file_name: selectedAvatar,
        website
      }),
      signal: AbortSignal.timeout(15000)
    });

    let data;
    try { data = await response.json(); } catch { data = {}; }

    if (response.ok && data.success) {
      inviteDebugLog('[Form] ✅ Account created successfully!');

      stopInviteAml();
      inviteAmlDrawOne(amlStage, 'check', () => {
        try {
          localStorage.removeItem('cx_invite_avatar_selection');
          localStorage.removeItem('cx_invite_token');
          localStorage.removeItem('cx_invite_nickname');
        } catch (error) {
          console.warn('[Form] localStorage unavailable:', error);
        }
        showSuccess();
      });
      return;
    }

    let errorMessage = data.error || 'Erro ao criar conta. Tente novamente.';

    if (response.status === 404) {
      errorMessage = 'Convite não encontrado';
    } else if (response.status === 410) {
      errorMessage = data.error;
    } else if (response.status === 403) {
      errorMessage = data.error;
    } else if (response.status === 409) {
      errorMessage = 'Este usuário já está cadastrado.';
    } else if (response.status === 400 && data.error.includes('Código')) {
      errorMessage = 'Código de convite incorreto. Verifique o código recebido.';
    }

    avatarError.textContent = errorMessage;
    avatarError.classList.remove('hidden');

    stopInviteAml();
    finishBtn.classList.remove('loading');
    finishBtn.disabled = false;

  } catch (error) {
    console.error('[Form] ❌ Network error or exception:', error);

    avatarError.textContent = error.name === 'TimeoutError'
      ? 'Tempo de resposta excedido. Verifique sua conexão e tente novamente.'
      : 'Erro de conexão. Verifique sua internet e tente novamente.';
    avatarError.classList.remove('hidden');

    stopInviteAml();
    finishBtn.classList.remove('loading');
    finishBtn.disabled = false;
  }
});

async function showSuccess() {
  showState('success');
  
  const hasExclusivePersona = exclusivePersonaSystem && exclusivePersonaSystem.isExclusive;
  
  if (hasExclusivePersona) {
    const successState = document.getElementById('success-state');
    
    const logumContainer = document.createElement('div');
    logumContainer.id = 'logum-success-container';
    logumContainer.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: 32px;
      padding: 24px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: var(--radius-md);
      border: 1px solid rgba(255, 255, 255, 0.1);
    `;
    
    successState.appendChild(logumContainer);
    
    try {
      const logumController = new LogumAnimationController(logumContainer);
      await logumController.animateAppearance();
      await logumController.showFinalMessage();
      inviteDebugLog('[Success] Logum final message complete, redirecting to /login');
    } catch (error) {
      console.error('[Success] Error showing Logum final message:', error);
    }

    try {
      localStorage.removeItem('cx_invite_avatar_selection');
      localStorage.removeItem('cx_invite_token');
      localStorage.removeItem('cx_invite_nickname');
    } catch (error) {
      console.warn('[Success] localStorage unavailable:', error);
    }
    
    successState.style.transition = 'opacity 0.5s ease-out';
    successState.style.opacity = '0';

    setTimeout(() => {
      window.location.href = '/login';
    }, 500);

  } else {
    inviteDebugLog('[Success] Standard flow detected, showing countdown');
    let countdown = 3;
    const countdownSection = document.getElementById('countdown-section');
    const countdownEl = document.getElementById('countdown');
    
    if (countdownSection && countdownEl) {
      countdownSection.style.display = 'block';
      
      const interval = setInterval(() => {
        countdown--;
        countdownEl.textContent = countdown;
        
        if (countdown === 0) {
          clearInterval(interval);
          window.location.href = '/login';
        }
      }, 1000);
    } else {
      setTimeout(() => {
        window.location.href = '/login';
      }, 2000);
    }

    try {
      localStorage.removeItem('cx_invite_avatar_selection');
      localStorage.removeItem('cx_invite_token');
      localStorage.removeItem('cx_invite_nickname');
    } catch (error) {
      console.warn('[Success] localStorage unavailable:', error);
    }
  }
}

validateInvite();

preloadAvatarImages().catch(err => {
  console.warn('[Preload] Initial preload failed:', err);
});

let avatarSelector = null;
let exclusivePersonaSystem = null;
let currentNickname = null;

async function initializeAvatarSystem(nickname) {
  currentNickname = nickname;
  
  try {
    const container = document.getElementById('avatar-selector-container');
    if (!container) {
      console.error('[Avatar System] Container not found');
      return;
    }

    avatarSelector = new AvatarSelector(container, {
      onSelect: (avatarFilename) => {
        inviteDebugLog('[Avatar System] Avatar selected:', avatarFilename);

        const finishBtn = document.getElementById('finish-btn');
        if (finishBtn) {
          finishBtn.disabled = false;
          finishBtn.style.opacity = '1';
          finishBtn.style.cursor = 'pointer';
          finishBtn.title = '';
        }
        
        const avatarError = document.getElementById('avatar-error');
        if (avatarError) {
          avatarError.classList.add('hidden');
        }
      }
    });

    await avatarSelector.init();
    inviteDebugLog('[Avatar System] Avatar selector initialized');

    exclusivePersonaSystem = new ExclusivePersonaSystem(nickname, {
      onComplete: async (selectedAvatar) => {
        inviteDebugLog('[Avatar System] Exclusive persona flow complete:', selectedAvatar);

        inviteData.avatar = selectedAvatar;

        try {
          if (!token || !inviteData.code || !inviteData.password || !selectedAvatar) {
            console.error('[Avatar System] ❌ Missing required data for POST:', {
              token: !!token,
              code: !!inviteData.code,
              password: !!inviteData.password,
              avatar: !!selectedAvatar
            });

            alert('Por favor, complete todos os passos:\n1. Digite o código do convite\n2. Crie uma senha\n3. Escolha seu avatar');
            window.location.reload();
            return;
          }

          inviteDebugLog('[Avatar System] 📤 Sending POST to /api/accept-invite');

          const response = await fetch('/api/accept-invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              token, 
              invite_code: inviteData.code, 
              password: inviteData.password,
              avatar_file_name: selectedAvatar,
              website: '' // Honeypot field
            })
          });
          
          inviteDebugLog('[Avatar System] accept-invite response status:', response.status);

          const data = await response.json();

          if (response.ok && data.success) {
            inviteDebugLog('[Avatar System] account created successfully');

            try {
              localStorage.removeItem('cx_invite_avatar_selection');
              localStorage.removeItem('cx_invite_token');
              localStorage.removeItem('cx_invite_nickname');
            } catch (error) {
              console.warn('[Avatar System] localStorage unavailable:', error);
            }
            
            showSuccess();
          } else {
            console.error('[Avatar System] ❌ Account creation failed:', data.error);
            alert(`Erro ao criar conta: ${data.error || 'Erro desconhecido'}`);

            const finishBtn = document.getElementById('finish-btn');
            if (finishBtn) {
              finishBtn.disabled = false;
              finishBtn.style.opacity = '1';
              finishBtn.style.cursor = 'pointer';
              finishBtn.title = '';
            }
          }

        } catch (error) {
          console.error('[Avatar System] ❌ Network error:', error);
          alert('Erro de conexão. Verifique sua internet e tente novamente.');

          const finishBtn = document.getElementById('finish-btn');
          if (finishBtn) {
            finishBtn.disabled = false;
            finishBtn.style.opacity = '1';
            finishBtn.style.cursor = 'pointer';
            finishBtn.title = '';
          }
        }
      }
    });

    // Exposed globally so AvatarSelector can check for exclusive persona state
    window.exclusivePersonaSystem = exclusivePersonaSystem;

    const exclusiveResult = await exclusivePersonaSystem.detectExclusiveAvatar();
    
    if (exclusiveResult.exists) {
      inviteDebugLog('[Avatar System] Exclusive avatar detected for:', nickname);

      const baseUrl = exclusiveResult.url;
      const coolUrl = baseUrl.replace('.webp', 'cool.webp').replace('.png', 'cool.png');

      const preloadBase = new Image();
      preloadBase.src = baseUrl;

      const preloadCool = new Image();
      preloadCool.src = coolUrl;

    } else {
      inviteDebugLog('[Avatar System] Standard avatar flow for:', nickname);
    }

  } catch (error) {
    console.error('[Avatar System] Initialization error:', error);
    const avatarError = document.getElementById('avatar-error');
    if (avatarError) {
      avatarError.textContent = 'Erro ao carregar avatares. Tente recarregar a página.';
      avatarError.classList.remove('hidden');
    }
  }
}


let pendingAvatarSelection = null;

function openAvatarModal(avatarData) {
  const modal = document.getElementById('avatar-modal');
  const image = document.getElementById('avatar-modal-image');
  const name = document.getElementById('avatar-modal-name');
  const description = document.getElementById('avatar-modal-description');
  
  image.src = avatarData.imagePath;
  image.alt = avatarData.name;
  name.textContent = avatarData.name;
  description.textContent = avatarData.description || 'Um personagem único para sua jornada.';
  
  pendingAvatarSelection = avatarData.filename;

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeAvatarModal() {
  const modal = document.getElementById('avatar-modal');
  
  modal.classList.add('hidden');
  pendingAvatarSelection = null;
  document.body.style.overflow = '';
}

async function confirmAvatarSelection() {
  if (!pendingAvatarSelection) {
    console.warn('[Modal] No pending avatar selection');
    return;
  }
  
  // Store before closing — closeAvatarModal() clears pendingAvatarSelection
  const selectedAvatar = pendingAvatarSelection;
  inviteDebugLog('[Modal] Confirming avatar selection:', selectedAvatar);

  closeAvatarModal();

  // Exclusive persona flow is handled by AvatarSelector.js; this covers standard selection only
  if (avatarSelector) {
    avatarSelector.selectAvatar(selectedAvatar);
  }
  
  const avatarError = document.getElementById('avatar-error');
  if (avatarError) {
    avatarError.classList.add('hidden');
  }
}

document.addEventListener('click', (e) => {
  const modal = document.getElementById('avatar-modal');
  if (e.target.classList.contains('avatar-modal-overlay')) {
    closeAvatarModal();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('avatar-modal');
    if (!modal.classList.contains('hidden')) {
      closeAvatarModal();
    }
  }
});


window.addEventListener('load', () => {
  const allLoaded =
    typeof window.ExclusiveAvatarRevealFlow !== 'undefined' &&
    typeof window.LogumAnimationController !== 'undefined' &&
    typeof window.TimingConfig !== 'undefined' &&
    typeof window.ExclusivePersonaSystem !== 'undefined' &&
    typeof window.AvatarSelector !== 'undefined';

  if (allLoaded) {
    inviteDebugLog('[INVITE.JS] ✅ All dependencies loaded successfully!');
  } else {
    console.error('[INVITE.JS] ❌ Some dependencies failed to load!');
  }
});
