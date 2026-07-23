const { createClient } = require('@supabase/supabase-js');
const { requireCxSession } = require('./_utils/request-auth');

function createSupabaseClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      global: {
        fetch: (url, options = {}) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);
          return fetch(url, { ...options, signal: controller.signal })
            .finally(() => clearTimeout(timeoutId));
        }
      }
    }
  );
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const auth = await requireCxSession(req);
  if (!auth.ok) {
    return res.status(auth.status).json({
      error: auth.error,
      message: auth.message
    });
  }

  try {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from('user_progress')
      .select(`
        user_id,
        xp,
        level,
        completed_challenges,
        completed_minigames,
        attempt_history,
        updated_at
      `)
      .eq('user_id', auth.user.id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const { data: profile, error: profileError } = await supabase
      .from('usuarios')
      .select('nickname, display_name, ranking_code, avatar_file_name')
      .eq('id', auth.user.id)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    const profileData = profile || {};

    return res.status(200).json({
      user_id: auth.user.id,
      xp: data?.xp || 0,
      level: data?.level || 1,
      completed_challenges: data?.completed_challenges || [],
      completed_minigames: data?.completed_minigames || [],
      attempt_history: data?.attempt_history || [],
      nickname: profileData.nickname || auth.user.nickname || null,
      display_name: profileData.display_name || null,
      ranking_code: profileData.ranking_code || null,
      avatar_file_name: profileData.avatar_file_name || null,
      updated_at: data?.updated_at || null
    });
  } catch (error) {
    console.error('[progress] failed to load progress:', error.message);
    return res.status(503).json({
      error: 'progress_unavailable',
      message: 'Progresso temporariamente indisponivel.',
      retryable: true
    });
  }
};
