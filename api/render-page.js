/**
 * Server-side HTML rendering for public pages.
 * Injects Supabase public config from Vercel environment variables at request time.
 */

const fs = require('fs');
const path = require('path');
const { getSupabasePublicConfig } = require('./_utils/supabase-public-key');

const PAGE_ALIASES = Object.freeze({
  app: 'app.html',
  home: 'app.html',
  'app.html': 'app.html',
  'home.html': 'app.html'
});

const PUBLIC_PAGES = new Set([
  '404.html',
  'app.html',
  'challenge.html',
  'conquistas.html',
  'ecdesignsystem.html',
  'index.html',
  'login.html',
  'maintenance.html',
  'momento-critico.html',
  'outside-window.html',
  'ranking.html',
  'resgatar.html',
  'season-closed.html',
  'sobre.html',
]);

function resolvePagePath(requestedPage) {
  const resolvedPage = PAGE_ALIASES[requestedPage] || requestedPage;

  if (resolvedPage === 'invite/index.html') {
    return path.join('invite', 'index.html');
  }

  if (!PUBLIC_PAGES.has(resolvedPage)) {
    return null;
  }

  return resolvedPage;
}

function serializeAppConfigForScript(appConfig) {
  return JSON.stringify(appConfig)
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function handler(req, res) {
  try {
    const requestedPage = String(req.query.page || 'index.html');
    const pagePath = resolvePagePath(requestedPage);

    if (
      requestedPage.includes('..')
      || requestedPage.includes('//')
      || (pagePath && pagePath.includes('..'))
      || (pagePath && pagePath.includes('//'))
    ) {
      return res.status(400).json({ error: 'Invalid page path' });
    }

    const fallback404Path = path.join(process.cwd(), '404.html');
    let statusCode = 200;
    let htmlPath = pagePath ? path.join(process.cwd(), pagePath) : fallback404Path;

    if (!pagePath) {
      statusCode = 404;
    }

    if (!fs.existsSync(htmlPath)) {
      if (!fs.existsSync(fallback404Path)) {
        return res.status(404).json({ error: 'Page not found' });
      }

      statusCode = 404;
      htmlPath = fallback404Path;
    }

    let html = fs.readFileSync(htmlPath, 'utf8');
    const appConfig = getSupabasePublicConfig();

    const configScript = `
    <script>
      window.__APP_CONFIG__ = ${serializeAppConfigForScript(appConfig)};
    </script>`;

    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>${configScript}`);
    } else if (html.includes('</head>')) {
      html = html.replace('</head>', `${configScript}\n</head>`);
    } else if (html.includes('<body>')) {
      html = html.replace('<body>', `<body>\n${configScript}`);
    } else {
      html = `${configScript}\n${html}`;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.status(statusCode).send(html);
  } catch (error) {
    console.error('[SSR] Failed to render page:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

handler.serializeAppConfigForScript = serializeAppConfigForScript;

module.exports = handler;
