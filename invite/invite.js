(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var token = (params.get('token') || '').trim().toLowerCase();
  var state = { accountExists: false, avatar: null, nickname: null };

  function showState(name) {
    ['loading', 'error', 'form', 'success'].forEach(function (part) {
      document.getElementById(part + '-state').classList.toggle('hidden', part !== name);
    });
  }

  function showError(message) {
    document.getElementById('error-message').textContent = message;
    showState('error');
  }

  function showStep(name, number) {
    ['code', 'character', 'passkey'].forEach(function (part) {
      document.getElementById('step-' + part).classList.toggle('hidden', part !== name);
      document.getElementById('step-' + part).classList.toggle('active', part === name);
    });
    document.querySelectorAll('#step-indicator .step').forEach(function (step) {
      step.classList.toggle('active', Number(step.dataset.step) <= number);
    });
  }

  function localSession(user) {
    var storage = window.CxSession?.getPrimaryStorage?.() || sessionStorage;
    storage.setItem('cx_logged_in_user', user.id);
    storage.setItem('cx_logged_in_user_email', user.nickname || '');
    storage.setItem('loggedIn', 'true');
    var users = JSON.parse(storage.getItem('cx_users') || '{}');
    users[user.id] = Object.assign({ level: 1, xp: 0, completedChallenges: [] }, users[user.id] || {}, {
      nickname: user.nickname || '', avatar_file_name: user.avatar_file_name || null
    });
    storage.setItem('cx_users', JSON.stringify(users));
  }

  async function initializeAvatarSelector() {
    var container = document.getElementById('avatar-selector-container');
    var next = document.getElementById('character-next');
    var selector = new window.AvatarSelector(container, {
      onSelect: function (filename) {
        state.avatar = filename;
        next.disabled = false;
        document.getElementById('avatar-error').classList.add('hidden');
      }
    });
    try {
      await selector.init();
    } catch (error) {
      document.getElementById('avatar-error').textContent = 'Não foi possível carregar os personagens. Recarregue a página.';
      document.getElementById('avatar-error').classList.remove('hidden');
    }
  }

  document.getElementById('code-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var input = document.getElementById('invite-code');
    var error = document.getElementById('code-error');
    var code = input.value.trim().toUpperCase();
    var button = event.currentTarget.querySelector('button');
    error.classList.add('hidden');
    if (!/^EC-[A-F0-9]{4}-[A-F0-9]{5}-[A-F0-9]{5}$/.test(code)) {
      error.textContent = 'Digite o código no formato EC-1234-12345-12345.';
      error.classList.remove('hidden');
      return;
    }
    button.disabled = true;
    try {
      var result = await window.PasskeyClient.api('/activation/verify', { token: token, code: code });
      state.accountExists = result.account_exists;
      state.nickname = result.nickname;
      var nicknameDisplay = document.getElementById('nickname-display');
      nicknameDisplay.textContent = result.nickname ? 'Conta confirmada: ' + result.nickname : 'Conta confirmada.';
      nicknameDisplay.classList.remove('identity-pending');
      if (state.accountExists) {
        document.querySelector('[data-step="2"]').style.display = 'none';
        document.querySelectorAll('#step-indicator .step-line')[0].style.display = 'none';
        document.getElementById('activation-intro').textContent = 'Sua conta existe. Cadastre uma nova passkey sem alterar seu personagem.';
        showStep('passkey', 3);
      } else {
        showStep('character', 2);
        initializeAvatarSelector();
      }
    } catch (exception) {
      error.textContent = exception.message || 'Não foi possível validar o código.';
      error.classList.remove('hidden');
      button.disabled = false;
    }
  });

  document.getElementById('character-next').addEventListener('click', function () {
    if (!state.avatar) return;
    showStep('passkey', 3);
  });

  document.getElementById('create-passkey').addEventListener('click', async function (event) {
    var button = event.currentTarget;
    var error = document.getElementById('passkey-error');
    error.classList.add('hidden');
    button.disabled = true;
    try {
      var result = await window.PasskeyClient.registerPasskey(state.accountExists ? {} : { avatar_file_name: state.avatar });
      localSession(result.user);
      showState('success');
      window.setTimeout(function () { window.location.replace('/app'); }, 900);
    } catch (exception) {
      error.textContent = exception.message || 'Não foi possível criar a passkey.';
      error.classList.remove('hidden');
      button.disabled = false;
    }
  });

  if (!/^[a-f0-9]{64}$/.test(token)) {
    showError('Este link de ativação é inválido. Peça um novo convite ao administrador.');
  } else {
    showState('form');
    showStep('code', 1);
  }
})();
