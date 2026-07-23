(function (global) {
  'use strict';

  function baseUrl() {
    return global.CXGAME_VPS_API_BASE || global.__APP_CONFIG__?.CXGAME_VPS_API_BASE || 'https://api.expconnect.com.br';
  }

  function toBuffer(value) {
    var normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    normalized += '='.repeat((4 - normalized.length % 4) % 4);
    var binary = atob(normalized);
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  }

  function toBase64Url(value) {
    var bytes = new Uint8Array(value);
    var binary = '';
    for (var index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function creationOptions(options) {
    var publicKey = Object.assign({}, options, {
      challenge: toBuffer(options.challenge),
      user: Object.assign({}, options.user, { id: toBuffer(options.user.id) })
    });
    publicKey.excludeCredentials = (options.excludeCredentials || []).map(function (credential) {
      return Object.assign({}, credential, { id: toBuffer(credential.id) });
    });
    return publicKey;
  }

  function requestOptions(options) {
    var publicKey = Object.assign({}, options, { challenge: toBuffer(options.challenge) });
    publicKey.allowCredentials = (options.allowCredentials || []).map(function (credential) {
      return Object.assign({}, credential, { id: toBuffer(credential.id) });
    });
    return publicKey;
  }

  function credentialJson(credential) {
    var response = credential.response;
    var payload = {
      id: credential.id,
      rawId: toBase64Url(credential.rawId),
      type: credential.type,
      response: { clientDataJSON: toBase64Url(response.clientDataJSON) }
    };
    if (response.attestationObject) {
      payload.response.attestationObject = toBase64Url(response.attestationObject);
      if (typeof response.getTransports === 'function') payload.response.transports = response.getTransports();
    } else {
      payload.response.authenticatorData = toBase64Url(response.authenticatorData);
      payload.response.signature = toBase64Url(response.signature);
      if (response.userHandle) payload.response.userHandle = toBase64Url(response.userHandle);
    }
    if (credential.authenticatorAttachment) payload.authenticatorAttachment = credential.authenticatorAttachment;
    return payload;
  }

  async function api(path, body) {
    if (global.__ENV_READY__) await global.__ENV_READY__;
    var response = await fetch(baseUrl() + '/api/auth' + path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    var data = {};
    try { data = await response.json(); } catch (error) { /* handled below */ }
    if (!response.ok) throw new Error(data.detail || data.message || data.error || 'Não foi possível concluir esta etapa.');
    return data;
  }

  function supported() {
    return Boolean(global.PublicKeyCredential && navigator.credentials);
  }

  function promptError(error, action) {
    if (error && (error.name === 'NotAllowedError' || error.name === 'AbortError')) {
      return new Error(action === 'register'
        ? 'A criação da passkey foi cancelada. Você pode tentar novamente quando quiser.'
        : 'A confirmação foi cancelada. Tente novamente quando estiver pronto.');
    }
    return error instanceof Error ? error : new Error('Não foi possível concluir a confirmação da passkey.');
  }

  async function registerPasskey(registration) {
    if (!supported()) throw new Error('Este navegador não oferece suporte a passkeys. Use um navegador atualizado.');
    var options = await api('/passkeys/register/options', registration || {});
    var credential;
    try {
      credential = await navigator.credentials.create({ publicKey: creationOptions(options.public_key) });
    } catch (error) {
      throw promptError(error, 'register');
    }
    if (!credential) throw new Error('A criação da passkey foi cancelada.');
    var payload = credentialJson(credential);
    payload._challenge_id = options.challenge_id;
    return api('/passkeys/register/verify', { credential: payload });
  }

  async function loginWithPasskey(username) {
    if (!supported()) throw new Error('Este navegador não oferece suporte a passkeys. Use um navegador atualizado.');
    var options = await api('/passkeys/login/options', { username: username });
    var credential;
    try {
      credential = await navigator.credentials.get({ publicKey: requestOptions(options.public_key) });
    } catch (error) {
      throw promptError(error, 'login');
    }
    if (!credential) throw new Error('A autenticação foi cancelada.');
    var payload = credentialJson(credential);
    payload._challenge_id = options.challenge_id;
    return api('/passkeys/login/verify', { credential: payload });
  }

  global.PasskeyClient = {
    supported: supported,
    api: api,
    registerPasskey: registerPasskey,
    loginWithPasskey: loginWithPasskey
  };
})(window);
