function apiDebugLog(...args) {
  if (process.env.CXGAME_DEBUG_API === 'true') {
    console.debug(...args);
  }
}

// SECURITY: Never commit credentials. Credentials are loaded exclusively from
// FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_BASE64 env vars.

let serviceAccount = null;

function getServiceAccount() {
  if (serviceAccount) {
    return serviceAccount;
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      apiDebugLog('[Firebase Config] Loaded from FIREBASE_SERVICE_ACCOUNT');
      return serviceAccount;
    } catch (error) {
      console.error('[Firebase Config] Failed to parse FIREBASE_SERVICE_ACCOUNT:', error.message);
    }
  }

  // Base64-encoded variant is more reliable on Vercel (avoids JSON escaping issues)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    try {
      const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
      serviceAccount = JSON.parse(decoded);
      apiDebugLog('[Firebase Config] Loaded from FIREBASE_SERVICE_ACCOUNT_BASE64');
      return serviceAccount;
    } catch (error) {
      console.error('[Firebase Config] Failed to parse FIREBASE_SERVICE_ACCOUNT_BASE64:', error.message);
    }
  }

  throw new Error('Firebase service account not configured. Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_BASE64 environment variable.');
}

module.exports = { getServiceAccount };
