// The browser never receives a password or a bearer token. The HttpOnly
// cx_session cookie is issued only by the VPS after a verified assertion.
async function handleLogin(event) {
  event.preventDefault();
  var button = document.getElementById('login-btn');
  var error = document.getElementById('error-message');
  if (button.disabled) return;
  button.disabled = true;
  button.classList.add('loading');
  error.classList.remove('show');
  try {
    var result = await window.PasskeyClient.loginWithPasskey();
    await storeSessionContext(result.user);
    var overlay = document.getElementById('ec-redirect-overlay');
    if (overlay) overlay.classList.add('show');
    window.location.replace('/app');
  } catch (exception) {
    error.querySelector('span').textContent = exception.message || 'Não foi possível entrar com a passkey.';
    error.classList.add('show');
    button.disabled = false;
    button.classList.remove('loading');
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
