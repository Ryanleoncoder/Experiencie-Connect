function getSupabasePublicKey() {
  return (
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY ||
    null
  );
}

function getSupabasePublicConfig() {
  const publicKey = getSupabasePublicKey();

  return {
    SUPABASE_URL: process.env.SUPABASE_URL || null,
    SUPABASE_PUBLISHABLE_KEY: publicKey,
    SUPABASE_ANON_KEY: publicKey,
    SUPABASE_KEY: publicKey,
    CXGAME_VPS_API_BASE: process.env.CXGAME_VPS_API_BASE || 'https://api.expconnect.com.br',
    CONTENT_SOURCE: process.env.CONTENT_SOURCE || 'supabase',
    FIREBASE_API_KEY: process.env.FIREBASE_API_KEY || null,
    FIREBASE_AUTH_DOMAIN: process.env.FIREBASE_AUTH_DOMAIN || null,
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || null,
    FIREBASE_STORAGE_BUCKET: process.env.FIREBASE_STORAGE_BUCKET || null,
    FIREBASE_MESSAGING_SENDER_ID: process.env.FIREBASE_MESSAGING_SENDER_ID || null,
    FIREBASE_APP_ID: process.env.FIREBASE_APP_ID || null
  };
}

module.exports = {
  getSupabasePublicKey,
  getSupabasePublicConfig
};
