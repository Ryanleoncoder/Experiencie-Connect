// replace() preserva o histórico: o usuário não consegue voltar ao login com o botão Voltar.
if (sessionStorage.getItem('loggedIn') === 'true' && sessionStorage.getItem('cx_logged_in_user')) {
  window.location.replace('/app');
}

const SUPABASE_URL =
  window.SUPABASE_URL ||
  localStorage.getItem('SUPABASE_URL');

const SUPABASE_KEY =
  window.SUPABASE_PUBLISHABLE_KEY ||
  window.SUPABASE_KEY ||
  window.SUPABASE_ANON_KEY ||
  localStorage.getItem('SUPABASE_PUBLISHABLE_KEY') ||
  localStorage.getItem('SUPABASE_KEY');

(function () {
  var btn = document.getElementById('toggle-password');
  var input = document.getElementById('password');
  var slash = document.getElementById('eyeSlash');
  if (!btn || !input || !slash) return;
  slash.style.display = 'none';
  btn.addEventListener('click', function () {
    var show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    slash.style.display = show ? 'block' : 'none';
  });
})();

var _supabasePromise = null;
function getSupabaseClient() {
  // SDK carregado sob demanda para não bloquear o render inicial da página.
  if (_supabasePromise) return _supabasePromise;
  _supabasePromise = (async () => {
    if (!window.supabase) {
      await new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
        s.defer = true;
        s.onload = resolve;
        s.onerror = function () { reject(new Error('Falha ao carregar Supabase SDK')); };
        document.head.appendChild(s);
      });
    }
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('SUPABASE_URL/KEY não configurados');
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  })();
  return _supabasePromise;
}

var AML_SYMBOLS = {
  ec:       '<text x="14" y="19" font-family="DM Sans" font-weight="800" font-size="13" fill="currentColor" stroke="none" text-anchor="middle" class="aml-letters">EC</text>',
  sentury:  '<rect x="6" y="9" width="16" height="12" rx="3" class="aml-draw" style="--len:60"/><line x1="14" y1="5" x2="14" y2="9" class="aml-draw" style="--len:6"/><circle cx="14" cy="4" r="1.4" fill="currentColor" stroke="none"/><circle cx="10.5" cy="15" r="1.3" fill="currentColor" stroke="none"/><circle cx="17.5" cy="15" r="1.3" fill="currentColor" stroke="none"/>',
  thinking: '<rect x="6" y="9" width="16" height="12" rx="3" class="aml-draw" style="--len:60"/><line x1="14" y1="5" x2="14" y2="9"/><circle cx="14" cy="4" r="1.4" fill="currentColor" stroke="none"/><line x1="10" y1="15" x2="12" y2="15" class="aml-draw" style="--len:3"/><line x1="16" y1="15" x2="18" y2="15" class="aml-draw" style="--len:3"/>',
  xp:       '<text x="14" y="19" font-family="Space Mono" font-weight="700" font-size="12" fill="currentColor" stroke="none" text-anchor="middle">XP</text>',
  vinyl:    '<circle cx="14" cy="14" r="11" class="aml-draw" style="--len:70"/><circle cx="14" cy="14" r="6" class="aml-draw" style="--len:38"/><circle cx="14" cy="14" r="1.6" fill="currentColor" stroke="none"/>',
  reward:   '<rect x="6" y="12" width="16" height="10" rx="1.5" class="aml-draw" style="--len:52"/><line x1="6" y1="15.5" x2="22" y2="15.5" class="aml-draw" style="--len:16"/><line x1="14" y1="12" x2="14" y2="22" class="aml-draw" style="--len:10"/><path d="M14 12 C14 8 10 7.5 10 10 C10 12 14 12 14 12 Z" class="aml-draw" style="--len:14"/><path d="M14 12 C14 8 18 7.5 18 10 C18 12 14 12 14 12 Z" class="aml-draw" style="--len:14"/>',
  trophy:   '<path d="M9 5 H19 V10 a5 5 0 0 1 -10 0 Z" class="aml-draw" style="--len:34"/><path d="M9 6 H6 V8 a3 3 0 0 0 3 3" class="aml-draw" style="--len:14"/><path d="M19 6 H22 V8 a3 3 0 0 1 -3 3" class="aml-draw" style="--len:14"/><line x1="14" y1="15" x2="14" y2="19" class="aml-draw" style="--len:4"/><path d="M10 22 H18 L17 19 H11 Z" class="aml-draw" style="--len:24"/>',
  star:     '<path d="M14 3 L17 11 L25 11.5 L18.5 16.5 L21 24 L14 19.5 L7 24 L9.5 16.5 L3 11.5 L11 11 Z" class="aml-draw" style="--len:64"/>',
  check:    '<polyline points="6,14.5 12,20 22,8" class="aml-draw" style="--len:26"/>'
};

var AML_SPARK = '<svg class="aml-spark" viewBox="0 0 28 28"><line x1="14" y1="1" x2="14" y2="4"/><line x1="14" y1="24" x2="14" y2="27"/><line x1="1" y1="14" x2="4" y2="14"/><line x1="24" y1="14" x2="27" y2="14"/><line x1="5" y1="5" x2="7" y2="7"/><line x1="21" y1="21" x2="23" y2="23"/><line x1="23" y1="5" x2="21" y2="7"/><line x1="7" y1="21" x2="5" y2="23"/></svg>';

var AML_LOOP = ['ec', 'sentury', 'thinking', 'xp', 'vinyl', 'reward', 'trophy', 'star'];

// Cancela callbacks de timers de tentativas anteriores sem guardar referências.
var _amlGen = 0;

function amlDrawOne(stage, sym, onDone) {
  var gen = _amlGen;
  stage.innerHTML =
    '<div style="position:relative;width:26px;height:26px">' +
    '<svg class="aml-sym" viewBox="0 0 28 28">' + AML_SYMBOLS[sym] + '</svg>' +
    AML_SPARK + '</div>';
  var wrap = stage.firstChild;
  var svg = wrap.querySelector('.aml-sym');
  var spark = wrap.querySelector('.aml-spark');
  setTimeout(function () {
    if (_amlGen !== gen) return;
    svg.classList.add('aml-pulse');
    if (spark) spark.classList.add('on');
    setTimeout(function () {
      if (_amlGen !== gen) return;
      onDone();
    }, 360);
  }, 420);
}

function shakeCard() {
  // Web Animations API não substitui a propriedade CSS `animation` — preserva o loginCardFadeIn forwards.
  var card = document.getElementById('login-card');
  if (!card || !card.animate) return;
  card.animate([
    { transform: 'translateX(0)' },
    { transform: 'translateX(-8px)' },
    { transform: 'translateX(8px)' },
    { transform: 'translateX(-5px)' },
    { transform: 'translateX(5px)' },
    { transform: 'translateX(0)' }
  ], { duration: 400, easing: 'ease' });
}

async function handleLogin(event) {
  event.preventDefault();

  var btn = document.getElementById('login-btn');
  if (btn.classList.contains('loading') || btn.classList.contains('confirmed')) return;

  var usernameInput = document.getElementById('username').value.trim();
  var passwordInput = document.getElementById('password').value.trim();
  // Campo oculto para detecção de bots: crawlers preenchem todos os campos visíveis e invisíveis.
  var website = document.getElementById('website')?.value || '';
  var errorDiv = document.getElementById('error-message');

  if (!usernameInput || !passwordInput) {
    var msg = !usernameInput ? 'Preencha o campo de e-mail ou usuário.' : 'Preencha o campo de senha.';
    errorDiv.querySelector('span').textContent = msg;
    errorDiv.classList.add('show');
    shakeCard();
    return;
  }

  errorDiv.classList.remove('show');

  var stage = btn.querySelector('.cl-stage');
  var textEl = btn.querySelector('.cl-text');
  if (!btn.dataset.label) btn.dataset.label = textEl.innerHTML;
  btn.classList.add('loading');

  _amlGen++;
  var startGen = _amlGen;

  // API e animação em paralelo — _amlGen interrompe o loop quando a resposta chega.
  (async () => {
    try {
      var res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: usernameInput, password: passwordInput, website })
      });
      var data = await res.json();
      return (res.ok && data.success)
        ? { success: true, data }
        : { success: false, error: data.error || 'Usuário ou senha inválidos.' };
    } catch (e) {
      return { success: false, error: 'Erro de conexão. Tente novamente.' };
    }
  })().then(function (result) {
    if (_amlGen !== startGen) return;
    _amlGen++;
    if (result.success) {
      drawCheckAndConfirm(function () { doRedirect(result.data); });
    } else {
      doError(result.error);
    }
  });

  var symIdx = 0;

  function step() {
    if (_amlGen !== startGen) return;
    var sym = AML_LOOP[symIdx % AML_LOOP.length];
    symIdx++;
    amlDrawOne(stage, sym, step);
  }

  setTimeout(step, 300);

  function drawCheckAndConfirm(onConfirmed) {
    amlDrawOne(stage, 'check', function () {
      setTimeout(function () {
        btn.classList.remove('loading');
        btn.classList.add('confirmed');
        textEl.innerHTML =
          '<svg viewBox="0 0 24 24" style="width:18px;height:18px" fill="none">' +
          '<polyline points="5,12.5 10,17.5 19,7" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg> Entrou';
        stage.innerHTML = '';
        onConfirmed();
      }, 360);
    });
  }

  function doRedirect(data) {
    _amlGen++;
    var overlay = document.getElementById('ec-redirect-overlay');
    if (overlay) overlay.classList.add('show');
    _storeSessionAndSync(data, usernameInput).then(function () {
      window.location.href = '/app';
    });
  }

  function doError(errMsg) {
    _amlGen++;
    btn.classList.remove('loading');
    btn.classList.remove('confirmed');
    textEl.innerHTML = btn.dataset.label;
    errorDiv.querySelector('span').textContent = errMsg;
    errorDiv.classList.add('show');
    shakeCard();
  }
}

async function _storeSessionAndSync(data, usernameInput) {
  var user = data.user;
  var uid = user.id || usernameInput;
  var storage = window.CxSession?.getPrimaryStorage?.() || sessionStorage;

  // sessionStorage expira ao fechar o navegador — reduz risco em dispositivos compartilhados.
  // localStorage de versões anteriores é limpo para evitar conflito na verificação de sessão.
  localStorage.removeItem('cx_logged_in_user');
  localStorage.removeItem('cx_session_token');
  localStorage.removeItem('cx_ranking_code');
  localStorage.removeItem('cx_display_name');
  localStorage.removeItem('loggedIn');
  sessionStorage.removeItem('cx_logged_in_user');
  sessionStorage.removeItem('cx_session_token');
  sessionStorage.removeItem('cx_ranking_code');
  sessionStorage.removeItem('cx_display_name');
  sessionStorage.removeItem('loggedIn');

  storage.setItem('cx_logged_in_user', uid);
  storage.setItem('cx_logged_in_user_email', user.nickname || usernameInput.toLowerCase());
  if (user.ranking_code) {
    storage.setItem('cx_ranking_code', user.ranking_code);
  }
  if (user.display_name) {
    storage.setItem('cx_display_name', user.display_name);
  }
  storage.setItem('loggedIn', 'true');
  if (data.sessionToken) {
    storage.setItem('cx_session_token', data.sessionToken);
  }

  var users = JSON.parse(storage.getItem('cx_users') || '{}');
  if (!users[uid]) {
    users[uid] = {
      nickname: user.nickname || usernameInput,
      display_name: user.display_name || null,
      ranking_code: user.ranking_code || null,
      avatar_file_name: user.avatar_file_name || null,
      level: 1,
      xp: 0,
      completedChallenges: []
    };
  }

  try {
    if (window.progressSync) {
      await window.progressSync.initialize();
      var remoteProgress = await window.progressSync.loadProgressFromSupabase(uid);
      if (remoteProgress) {
        users[uid] = {
          ...users[uid],
          xp: remoteProgress.xp,
          level: remoteProgress.level,
          completedChallenges: remoteProgress.completed_challenges,
          completedMinigames: remoteProgress.completed_minigames,
          attemptHistory: remoteProgress.attempt_history,
          display_name: remoteProgress.display_name || users[uid].display_name || null,
          ranking_code: remoteProgress.ranking_code || users[uid].ranking_code || null,
          avatar_file_name: remoteProgress.avatar_file_name || users[uid].avatar_file_name || null
        };
      }
    }
  } catch (syncErr) {
    console.error('[Login] Progress sync failed:', syncErr);
  }

  storage.setItem('cx_users', JSON.stringify(users));
}

function showEcToast(msg, duration) {
  var t = document.getElementById('ecToast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(function () { t.classList.remove('show'); }, duration || 3000);
}

function showRegistrationDisabled(event) {
  event.preventDefault();
  // Cadastro por convite apenas — o fluxo público está desabilitado por decisão do produto.
  showEcToast('Cadastro desativado. Use um convite para criar sua conta.', 5000);
}

function showForgotPasswordMessage(event) {
  event.preventDefault();
  showEcToast('Entre em contato com o administrador para reset de senha.', 5000);
}

(function () {
  var errorMsg = document.getElementById('error-message');
  if (!errorMsg) return;
  document.querySelectorAll('.field input').forEach(function (input) {
    input.addEventListener('input', function () {
      errorMsg.classList.remove('show');
    });
  });
})();
