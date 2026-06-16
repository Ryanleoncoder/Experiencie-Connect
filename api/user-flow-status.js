const { createClient } = require('@supabase/supabase-js');
const { requireCxSession } = require('./_utils/request-auth');

const DEFAULT_SEASON_ID = 'S-2025-01';
const SEASON_ID_PATTERN = /^S-\d{4}-\d{2}$/;

function createSupabaseClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

async function getConfiguredSeasonState(supabase) {
  const { data, error } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'season_state')
    .single();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data?.value || null;
}

function isConfiguredSeasonAllowed(seasonId, seasonState) {
  if (!seasonState || seasonState.enforce_season_check === false) {
    return true;
  }

  const currentSeasonId = seasonState.current_season_id || seasonState.currentSeasonId || null;
  return !currentSeasonId || currentSeasonId === seasonId;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const auth = requireCxSession(req);
  if (!auth.ok) {
    return res.status(auth.status).json({
      error: auth.error,
      message: auth.message
    });
  }

  const rawSeasonId = req.query?.seasonId;
  const seasonId = (typeof rawSeasonId === 'string' ? rawSeasonId : DEFAULT_SEASON_ID).trim();

  if (!SEASON_ID_PATTERN.test(seasonId)) {
    return res.status(400).json({
      error: 'invalid_season_id',
      message: 'Temporada invalida.'
    });
  }

  try {
    const supabase = createSupabaseClient();
    const seasonState = await getConfiguredSeasonState(supabase);

    if (!isConfiguredSeasonAllowed(seasonId, seasonState)) {
      return res.status(404).json({
        error: 'season_not_found',
        message: 'Temporada nao encontrada.'
      });
    }

    const { data, error } = await supabase.rpc('get_user_flow_status', {
      p_user_id: auth.user.id,
      p_season_id: seasonId
    });

    if (error) {
      throw error;
    }

    return res.status(200).json(data || {
      challenge_statuses: [],
      intermission_statuses: []
    });
  } catch (error) {
    console.error('[user-flow-status] failed:', error.message);
    return res.status(503).json({
      error: 'flow_status_unavailable',
      message: 'Status temporariamente indisponivel.',
      retryable: true
    });
  }
};
