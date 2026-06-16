function apiDebugLog(...args) {
  if (process.env.CXGAME_DEBUG_API === 'true') {
    console.debug(...args);
  }
}

const admin = require('firebase-admin');
const { getServiceAccount } = require('../_config/firebase-service-account');
const ProgressFlow = require('../../frontend/js/services/ProgressFlow');

const _levelCache = new Map();
const LEVEL_CACHE_TTL = 5 * 60 * 1000;

if (!admin.apps.length) {
  try {
    apiDebugLog('[challenge-flow] Starting Firebase Admin initialization...');
    admin.initializeApp({
      credential: admin.credential.cert(getServiceAccount())
    });
    apiDebugLog('[challenge-flow] Firebase Admin initialized successfully');
  } catch (error) {
    console.error('[challenge-flow] Firebase Admin initialization failed:', error.message);
  }
}

function getStatusRank(status) {
  switch (status) {
    case 'completed':
      return 3;
    case 'failed':
      return 2;
    case 'in_progress':
      return 1;
    default:
      return 0;
  }
}

function shouldPreferBaseStatus(currentRow, nextRow) {
  if (!currentRow) return true;

  const currentRank = getStatusRank(currentRow.status);
  const nextRank = getStatusRank(nextRow?.status);
  if (nextRank !== currentRank) {
    return nextRank > currentRank;
  }

  return Number(nextRow?.attempts_used || 0) > Number(currentRow?.attempts_used || 0);
}

function getChallengeId(challenge) {
  if (challenge && typeof challenge === 'object') {
    if (challenge.type === 'game') {
      return challenge.flow_challenge_id || challenge.flowChallengeId || challenge.challenge_id || challenge.id || null;
    }
    return challenge.challenge_id || challenge.challengeId || challenge.content_id || challenge.contentId || challenge.id || null;
  }
  return ProgressFlow.getChallengeId(challenge);
}

function normalizeChallengeId(challengeId) {
  return ProgressFlow.normalizeChallengeId
    ? ProgressFlow.normalizeChallengeId(challengeId)
    : challengeId;
}

function getLogicalChallengeId(challenge) {
  if (!challenge || typeof challenge !== 'object') {
    return normalizeChallengeId(challenge);
  }

  if (challenge.type === 'game') {
    return getChallengeId(challenge);
  }

  return challenge.logical_id
    || challenge.logicalId
    || normalizeChallengeId(getChallengeId(challenge));
}

function normalizePhaseSessionNode(node) {
  if (!node || typeof node !== 'object') return node;

  if (node.type === 'game') {
    const flowChallengeId = node.flow_challenge_id || node.flowChallengeId || node.challenge_id || node.id;
    return {
      ...node,
      id: flowChallengeId,
      challenge_id: flowChallengeId,
      flow_challenge_id: flowChallengeId
    };
  }

  const contentId = node.content_id || node.contentId || node.challenge_id || node.challengeId || node.id;
  const logicalId = node.logical_id || node.logicalId || normalizeChallengeId(contentId);
  return {
    ...node,
    id: contentId,
    challenge_id: contentId,
    logical_id: logicalId,
    content_id: contentId,
    type: node.type || 'challenge'
  };
}

function buildChallengeOrderFromPhaseSession(phaseSession) {
  if (!phaseSession || !Array.isArray(phaseSession.nodes)) {
    return null;
  }

  return phaseSession.nodes
    .map(normalizePhaseSessionNode)
    .filter(node => getChallengeId(node))
    .sort((left, right) => Number(left.order_index ?? 0) - Number(right.order_index ?? 0));
}

async function getLevelChallenges(level, setor = 'CX', seasonId = 'S-2025-01') {
  const cacheKey = `${seasonId}:${setor}_${level}`;
  const cached = _levelCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < LEVEL_CACHE_TTL) {
    return cached.data;
  }

  try {
    const db = admin.firestore();
    const docRef = db.doc(`seasons/${seasonId}/levels/${setor}_${level}`);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      console.warn(`[challenge-flow] Level document seasons/${seasonId}/levels/${setor}_${level} not found`);
      return [];
    }
    const data = docSnap.data();
    const questions = data.questions || [];
    _levelCache.set(cacheKey, { data: questions, ts: Date.now() });
    return questions;
  } catch (error) {
    console.error('[challenge-flow] Error loading level from Firestore:', error);
    return [];
  }
}

async function buildUserChallengeOrder({ userId, seasonId, level, setor = 'CX', count = 20 }) {
  const levelChallenges = await module.exports.getLevelChallenges(level, setor, seasonId);
  return ProgressFlow.buildPlayableFlow(levelChallenges, {
    userId,
    seasonId,
    level: Number(level),
    count
  });
}

async function loadChallengeStatusMap(supabase, userId, seasonId, level) {
  const { data, error } = await supabase
    .from('challenge_status')
    .select('challenge_id, status, attempts_used, level')
    .eq('user_id', userId)
    .eq('season_id', seasonId)
    .eq('level', Number(level));

  if (error) throw error;

  const map = new Map();
  (data || []).forEach(row => {
    if (row.challenge_id) {
      map.set(row.challenge_id, row);

      const baseId = normalizeChallengeId(row.challenge_id);
      if (baseId && baseId !== row.challenge_id) {
        const currentBaseRow = map.get(baseId);
        if (shouldPreferBaseStatus(currentBaseRow, row)) {
          map.set(baseId, {
            ...row,
            challenge_id: baseId,
            canonical_challenge_id: row.challenge_id
          });
        }
      }
    }
  });

  return map;
}

async function loadIntermissionStatusMap(supabase, userId, seasonId, level) {
  const { data, error } = await supabase
    .from('intermission_game_sessions')
    .select('challenge_id, percent, completed_at, level')
    .eq('user_id', userId)
    .eq('season_id', seasonId)
    .eq('level', Number(level));

  if (error) throw error;

  const map = new Map();
  (data || []).forEach(row => {
    if (!row.challenge_id) return;
    const current = map.get(row.challenge_id);
    if (!current || Number(row.percent || 0) > Number(current.percent || 0)) {
      map.set(row.challenge_id, row);
    }
  });

  return map;
}

function isProcessed(flowNode, challengeStatusMap, intermissionStatusMap) {
  const challengeId = getChallengeId(flowNode);
  if (!challengeId) return false;

  if (ProgressFlow.isIntermissionId(challengeId) || ProgressFlow.isIntermissionChallenge(flowNode)) {
    const status = intermissionStatusMap.get(challengeId);
    return Boolean(status && (status.completed_at || status.processed === true || status.status === 'completed'));
  }

  const logicalId = getLogicalChallengeId(flowNode);
  const status = challengeStatusMap.get(challengeId)
    || challengeStatusMap.get(logicalId)
    || challengeStatusMap.get(normalizeChallengeId(challengeId));
  return Boolean(status && (status.status === 'completed' || status.status === 'failed'));
}

async function validateChallengeAccessForUser({ supabase, userId, challengeId, level, seasonId, setor = 'CX', phaseSession = null }) {
  const challengeOrder = buildChallengeOrderFromPhaseSession(phaseSession)
    || await module.exports.buildUserChallengeOrder({ userId, seasonId, level, setor });
  const requestedBaseId = normalizeChallengeId(challengeId);
  const requestedIndex = challengeOrder.findIndex(challenge => {
    const nodeId = getChallengeId(challenge);
    const logicalId = getLogicalChallengeId(challenge);
    return normalizeChallengeId(nodeId) === requestedBaseId
      || normalizeChallengeId(logicalId) === requestedBaseId;
  });
  const firstChallengeId = getChallengeId(challengeOrder[0]);

  if (requestedIndex === -1) {
    return {
      isValid: false,
      redirectTo: firstChallengeId || null,
      reason: 'challenge_not_in_server_selection',
      challengeOrder
    };
  }

  const [challengeStatusMap, intermissionStatusMap] = await Promise.all([
    loadChallengeStatusMap(supabase, userId, seasonId, level),
    loadIntermissionStatusMap(supabase, userId, seasonId, level)
  ]);

  for (let index = 0; index < requestedIndex; index += 1) {
    const previous = challengeOrder[index];
    if (!isProcessed(previous, challengeStatusMap, intermissionStatusMap)) {
      return {
        isValid: false,
        redirectTo: getChallengeId(previous),
        reason: 'previous_challenge_not_processed',
        challengeOrder
      };
    }
  }

  return {
    isValid: true,
    redirectTo: null,
    reason: 'server_prerequisites_met',
    challengeOrder
  };
}

module.exports = {
  buildUserChallengeOrder,
  buildChallengeOrderFromPhaseSession,
  getChallengeId,
  getLogicalChallengeId,
  getLevelChallenges,
  loadChallengeStatusMap,
  validateChallengeAccessForUser
};
