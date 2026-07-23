// The browser never receives a password or a bearer token. The HttpOnly
// cx_session cookie is issued only by the VPS after a verified assertion.
// This is the login Action Morph Loader from the EC design system: EC → Sentury → check.
var AML_SYMBOLS = {
  ec: '<text x="14" y="19" font-family="DM Sans" font-weight="800" font-size="13" fill="currentColor" stroke="none" text-anchor="middle" class="aml-letters">EC</text>',
  sentury: '<rect x="6" y="9" width="16" height="12" rx="3" class="aml-draw" style="--len:60"/><line x1="14" y1="5" x2="14" y2="9" class="aml-draw" style="--len:6"/><circle cx="14" cy="4" r="1.4" fill="currentColor" stroke="none"/><circle cx="10.5" cy="15" r="1.3" fill="currentColor" stroke="none"/><circle cx="17.5" cy="15" r="1.3" fill="currentColor" stroke="none"/>',
  check: '<polyline points="6,14.5 12,20 22,8" class="aml-draw" style="--len:26"/>'
};

var AML_SPARK = '<svg class="aml-spark" viewBox="0 0 28 28"><line x1="14" y1="1" x2="14" y2="4"/><line x1="14" y1="24" x2="14" y2="27"/><line x1="1" y1="14" x2="4" y2="14"/><line x1="24" y1="14" x2="27" y2="14"/><line x1="5" y1="5" x2="7" y2="7"/><line x1="21" y1="21" x2="23" y2="23"/><line x1="23" y1="5" x2="21" y2="7"/><line x1="7" y1="21" x2="5" y2="23"/></svg>';
var AML_DRAW = 420;
var AML_PULSE = 360;
var amlGeneration = 0;

function drawAmlSymbol(stage, symbol, generation, onDone) {
  stage.innerHTML = '<div style="position:relative;width:26px;height:26px"><svg class="aml-sym" viewBox="0 0 28 28">' + AML_SYMBOLS[symbol] + '</svg>' + AML_SPARK + '</div>';
  var wrap = stage.firstChild;
  var svg = wrap.querySelector('.aml-sym');
  var spark = wrap.querySelector('.aml-spark');
  setTimeout(function () {
    if (amlGeneration !== generation) return;
    svg.classList.add('aml-pulse');
    spark.classList.add('on');
    setTimeout(function () {
      if (amlGeneration === generation) onDone();
    }, AML_PULSE);
  }, AML_DRAW);
}

function startLoginMorph(button) {
  var stage = button.querySelector('.cl-stage');
  var text = button.querySelector('.cl-text');
  var generation = ++amlGeneration;
  var index = 0;
  var processing = ['ec', 'sentury'];

  if (!button.dataset.label) button.dataset.label = text.innerHTML;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.classList.add('loading');

  function step() {
    if (amlGeneration !== generation) return;
    drawAmlSymbol(stage, processing[index % processing.length], generation, step);
    index += 1;
  }

  setTimeout(step, 300);

  return {
    complete: function (onComplete) {
      if (amlGeneration !== generation) return;
      var confirmationGeneration = ++amlGeneration;
      drawAmlSymbol(stage, 'check', confirmationGeneration, function () {
        button.classList.remove('loading');
        button.classList.add('confirmed');
        button.removeAttribute('aria-busy');
        text.innerHTML = '<svg viewBox="0 0 24 24" style="width:18px;height:18px" fill="none"><polyline points="5,12.5 10,17.5 19,7" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg> ' + button.dataset.done;
        stage.innerHTML = '';
        setTimeout(onComplete, AML_PULSE);
      });
    },
    reset: function () {
      if (amlGeneration !== generation) return;
      amlGeneration += 1;
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.classList.remove('loading', 'confirmed');
      text.innerHTML = button.dataset.label;
      stage.innerHTML = '';
    }
  };
}

function shakeLoginCard() {
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
  var button = document.getElementById('login-btn');
  var error = document.getElementById('error-message');
  var username = document.getElementById('username').value.trim();
  if (button.disabled || button.classList.contains('confirmed')) return;

  if (!username) {
    error.querySelector('span').textContent = 'Digite seu usuário para entrar.';
    error.classList.add('show');
    shakeLoginCard();
    return;
  }

  error.classList.remove('show');
  var morph = startLoginMorph(button);

  try {
    var result = await window.PasskeyClient.loginWithPasskey(username);
    morph.complete(async function () {
      await storeSessionContext(result.user);
      var overlay = document.getElementById('ec-redirect-overlay');
      if (overlay) overlay.classList.add('show');
      window.location.replace('/app');
    });
  } catch (exception) {
    morph.reset();
    error.querySelector('span').textContent = exception.message || 'Não foi possível entrar com a passkey.';
    error.classList.add('show');
    shakeLoginCard();
  }
}

async function storeSessionContext(user) {
  var storage = window.CxSession?.getPrimaryStorage?.() || sessionStorage;
  ['cx_logged_in_user', 'cx_session_token', 'cx_ranking_code', 'cx_display_name', 'loggedIn'].forEach(function (key) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  });
  storage.setItem('cx_logged_in_user', user.id);
  storage.setItem('cx_logged_in_user_email', user.nickname || '');
  storage.setItem('loggedIn', 'true');
  var users = JSON.parse(storage.getItem('cx_users') || '{}');
  users[user.id] = Object.assign({ level: 1, xp: 0, completedChallenges: [] }, users[user.id] || {}, {
    nickname: user.nickname || '', avatar_file_name: user.avatar_file_name || null
  });
  storage.setItem('cx_users', JSON.stringify(users));
  try {
    if (window.progressSync) {
      await window.progressSync.initialize();
      await window.progressSync.loadProgressFromSupabase(user.id);
    }
  } catch (error) {
    // Progress synchronizes again in the app; it is not an auth prerequisite.
  }
}
