function apiDebugLog(...args) {
  if (process.env.CXGAME_DEBUG_API === 'true') {
    console.debug(...args);
  }
}

const PRODUCTION_ORIGINS = [
  'https://www.expconnect.com.br',
  'https://expconnect.com.br',
  'https://cx-game.vercel.app',
  'https://cxgame-production.vercel.app',
  'https://cx-game-pre-alpha.vercel.app',
  'https://cx-game-beta.vercel.app'
];

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5500'
];

const IS_PRODUCTION =
  process.env.VERCEL_ENV === 'production' ||
  process.env.ENVIRONMENT === 'production';

const ALLOWED_ORIGINS = IS_PRODUCTION
  ? PRODUCTION_ORIGINS
  : [...PRODUCTION_ORIGINS, ...DEV_ORIGINS];

function validateCORS(req, res) {
  const origin = req.headers.origin;

  if (req.method === 'OPTIONS') {
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return false;
    }

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(200).end();
    return true;
  }

  if (!origin) {
    return true;
  }

  try {
    const originUrl = new URL(origin);
    const requestHost = req.headers.host;

    if (originUrl.host === requestHost) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      return true;
    }
  } catch (error) {
    apiDebugLog('[CORS] Invalid Origin header:', error.message);
  }

  if (!ALLOWED_ORIGINS.includes(origin)) {
    res.status(403).json({ error: 'Origin not allowed' });
    return false;
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');

  return true;
}

module.exports = { validateCORS, ALLOWED_ORIGINS };
