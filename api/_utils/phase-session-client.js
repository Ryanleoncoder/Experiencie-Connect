const ProgressFlow = require('../../frontend/js/services/ProgressFlow');

const DEFAULT_VPS_API_BASE = 'https://api.expconnect.com.br';
const PHASE_SESSION_TIMEOUT_MS = 4000;

function getVpsApiBase() {
  return String(process.env.CXGAME_VPS_API_BASE || DEFAULT_VPS_API_BASE).replace(/\/+$/, '');
}

function normalizeChallengeId(challengeId) {
  return ProgressFlow.normalizeChallengeId
    ? ProgressFlow.normalizeChallengeId(challengeId)
    : challengeId;
}

function getPhaseNodeChallengeId(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'game') {
    return node.flow_challenge_id || node.flowChallengeId || node.challenge_id || node.id || null;
  }
  return node.content_id || node.contentId || node.challenge_id || node.challengeId || node.id || null;
}

function getPhaseNodeLogicalId(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'game') {
    return getPhaseNodeChallengeId(node);
  }
  return node.logical_id || node.logicalId || normalizeChallengeId(getPhaseNodeChallengeId(node));
}

function normalizePhaseNode(node) {
  if (!node || typeof node !== 'object') return node;
  if (node.type === 'game') {
    const flowChallengeId = getPhaseNodeChallengeId(node);
    return {
      ...node,
      id: flowChallengeId,
      challenge_id: flowChallengeId,
      flow_challenge_id: flowChallengeId
    };
  }

  const contentId = getPhaseNodeChallengeId(node);
  const logicalId = getPhaseNodeLogicalId(node);
  return {
    ...node,
    id: contentId,
    challenge_id: contentId,
    logical_id: logicalId,
    content_id: contentId,
    type: node.type || 'challenge'
  };
}

function normalizePhaseSession(phaseSession) {
  if (!phaseSession || !Array.isArray(phaseSession.nodes)) {
    return phaseSession;
  }

  return {
    ...phaseSession,
    nodes: phaseSession.nodes.map(normalizePhaseNode)
  };
}

function resolvePhaseNode(phaseSession, requestedChallengeId) {
  const normalizedRequest = normalizeChallengeId(requestedChallengeId);
  return (normalizePhaseSession(phaseSession)?.nodes || []).find(node => {
    const contentId = getPhaseNodeChallengeId(node);
    const logicalId = getPhaseNodeLogicalId(node);
    return contentId === requestedChallengeId
      || logicalId === requestedChallengeId
      || normalizeChallengeId(contentId) === normalizedRequest
      || normalizeChallengeId(logicalId) === normalizedRequest;
  }) || null;
}

async function getPhaseSessionFromVps({ phaseSessionId, sessionToken, fetchImpl = fetch }) {
  if (!phaseSessionId) {
    throw new Error('phaseSessionId is required');
  }
  if (!sessionToken) {
    throw new Error('sessionToken is required');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PHASE_SESSION_TIMEOUT_MS);

  try {
    const response = await fetchImpl(`${getVpsApiBase()}/api/phase/sessions/${encodeURIComponent(phaseSessionId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${sessionToken}`
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Phase session unavailable: HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (payload?.state === 'blocked') {
      throw new Error('Phase session blocked or expired');
    }
    return normalizePhaseSession(payload);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  getPhaseNodeChallengeId,
  getPhaseNodeLogicalId,
  getPhaseSessionFromVps,
  normalizePhaseNode,
  normalizePhaseSession,
  resolvePhaseNode
};
