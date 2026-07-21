
(function (root) {
  const EXPECTED_SCHEMA_VERSION = 1;

  function getClient() {
    if (root.__sbContentClient) return root.__sbContentClient;
    const cfg = root.__APP_CONFIG__ || {};
    const url = root.SUPABASE_URL || cfg.SUPABASE_URL;
    const key = root.SUPABASE_PUBLISHABLE_KEY || root.SUPABASE_ANON_KEY
      || root.SUPABASE_KEY || cfg.SUPABASE_PUBLISHABLE_KEY || cfg.SUPABASE_ANON_KEY;
    if (!root.supabase || !url || !key) return null;
    root.__sbContentClient = root.supabase.createClient(url, key);
    return root.__sbContentClient;
  }

  function isDevEnv() {
    try {
      const h = root.location && root.location.hostname;
      return h === 'localhost' || h === '127.0.0.1' || h === '' || h === '[::1]';
    } catch (e) { return false; }
  }

  function isEnabled() {
    // Override por localStorage vale só em dev; em produção é ignorado — um valor
    // obsoleto (ex.: 'firebase') não pode quebrar o carregamento pós deny-all do Firestore.
    if (isDevEnv()) {
      try {
        const ls = root.localStorage && root.localStorage.getItem('cx_content_source');
        if (ls) return String(ls).toLowerCase() === 'supabase';
      } catch (e) { }
    }
    const v = (root.__APP_CONFIG__ && root.__APP_CONFIG__.CONTENT_SOURCE) || root.CONTENT_SOURCE || 'supabase';
    const src = String(v).toLowerCase();
    if (src !== 'supabase' && src !== 'firebase') {
      try { root.console && root.console.warn('[Content] CONTENT_SOURCE invalido:', v, '- usando supabase'); } catch (e) { }
      return true;
    }
    return src === 'supabase';
  }

  function challengeToQuestion(r) {
    const q = {
      id: r.challenge_id,
      tipo: r.tipo,
      ordem: r.ordem,
      titulo: r.titulo,
      descricao: r.descricao,
      categoria: r.categoria,
      alternativas: r.alternativas,
      xp: r.xp,
      tempo_limite: r.tempo_limite,
      ativo: r.ativo,
      tags: r.tags,
    };
    return Object.assign(q, r.metadata || {});
  }

  function gameToQuestion(g) {
    const meta = g.metadata || {};
    return Object.assign({
      id: g.flow_challenge_id,
      challenge_id: g.flow_challenge_id,
      tipo: 'intermission',
      type: g.type || 'intermission',
      slot_index: g.slot_index,
      level: g.level,
      setor: g.setor,
      titulo: g.title,
      title: g.title,
      descricao: g.description,
      description: g.description,
      xp: g.xp,
      alternativas: {},
      ordem: meta.ordem,
    }, meta);
  }

  async function loadLevelDoc(seasonId, setor, level) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase content client unavailable');

    const [lvRes, chRes, lgRes] = await Promise.all([
      sb.from('levels').select('*').eq('season_id', seasonId).eq('setor', setor).eq('level', level).maybeSingle(),
      sb.from('challenges').select('*').eq('season_id', seasonId).eq('setor', setor).eq('level', level).order('ordem'),
      sb.from('level_games').select('*').eq('season_id', seasonId).eq('setor', setor).eq('level', level),
    ]);
    if (chRes.error) throw chRes.error;

    const lv = lvRes.data || {};
    const questions = [
      ...(chRes.data || []).map(challengeToQuestion),
      ...(lgRes.data || []).map(gameToQuestion),
    ].sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0));

    return Object.assign({}, lv.metadata || {}, {
      season_id: seasonId,
      setor,
      level: Number(level),
      nome: lv.nome,
      icone: lv.icone,
      descricao: lv.descricao,
      cor: lv.cor,
      xp_multiplier: lv.xp_multiplier,
      total_xp: lv.total_xp,
      challenge_count: lv.challenge_count != null ? lv.challenge_count : questions.length,
      schema_version: lv.schema_version != null ? lv.schema_version : EXPECTED_SCHEMA_VERSION,
      questions,
    });
  }

  async function loadSeason(seasonId) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase content client unavailable');
    const { data, error } = await sb.from('content_seasons').select('*').eq('id', seasonId).maybeSingle();
    if (error) throw error;
    const s = data || {};
    const meta = s.metadata || {};
    return Object.assign({}, meta, {
      id: s.id || seasonId,
      nome: s.nome != null ? s.nome : meta.nome,
      total_levels: s.total_levels != null ? s.total_levels : (meta.total_levels != null ? meta.total_levels : 3),
      schema_version: s.schema_version != null ? s.schema_version : (meta.schema_version != null ? meta.schema_version : EXPECTED_SCHEMA_VERSION),
    });
  }

  async function loadAchievements() {
    const sb = getClient();
    if (!sb) throw new Error('Supabase content client unavailable');
    const { data, error } = await sb.from('achievements').select('*');
    if (error) throw error;
    const cv = (v) => (v != null && v !== '' && !isNaN(v)) ? Number(v) : v;
    return (data || []).map((a) => Object.assign({}, a.metadata || {}, {
      id: a.id, nome: a.nome, descricao: a.descricao, categoria: a.categoria, tipo: a.tipo,
      icone: a.icone, criterio_tipo: a.criterio_tipo, criterio_valor: cv(a.criterio_valor),
      xp_bonus: a.xp_bonus, nivel_requerido: a.nivel_requerido, ativo: a.ativo,
    }));
  }

  root.SupabaseContent = { getClient, isEnabled, loadLevelDoc, loadSeason, loadAchievements };
})(typeof window !== 'undefined' ? window : globalThis);
