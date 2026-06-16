(function initAchievementProgress(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.AchievementProgress = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function buildAchievementProgress() {
  function normalizeArray(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function pickArray(source, camelKey, snakeKey) {
    return normalizeArray(source?.[camelKey] || source?.[snakeKey]);
  }

  function normalizeAchievementProgress(source = {}, overrides = {}) {
    const completedChallenges = normalizeArray(
      overrides.completedChallenges || pickArray(source, 'completedChallenges', 'completed_challenges')
    );
    const completedMinigames = normalizeArray(
      overrides.completedMinigames || pickArray(source, 'completedMinigames', 'completed_minigames')
    );
    const failedChallenges = normalizeArray(
      overrides.failedChallenges || pickArray(source, 'failedChallenges', 'failed_challenges')
    );
    const logumChallenges = normalizeArray(
      overrides.logumChallenges || pickArray(source, 'logumChallenges', 'logum_challenges')
    );

    return {
      xp: Number(source?.xp || 0),
      level: Number(source?.level || 1),
      completedChallenges,
      completedMinigames,
      failedChallenges,
      logumChallenges,
      combined: completedChallenges.length + completedMinigames.length
    };
  }

  function deriveAllLevelsPerformance(flowStatus, levelIds = [1, 2, 3], requiredPerLevel = 20) {
    const statuses = Array.isArray(flowStatus?.challenge_statuses) ? flowStatus.challenge_statuses : [];
    if (!statuses.length) {
      return null;
    }

    const levelStats = {};
    for (const levelId of levelIds) {
      const levelPattern = new RegExp(`${levelId}\\d{2}`);
      const levelStatuses = statuses.filter(item => levelPattern.test(String(item?.challenge_id || '')));
      const completed = levelStatuses.filter(item => item?.status === 'completed').length;
      const failed = levelStatuses.filter(item => item?.status === 'failed').length;
      const processed = completed + failed;

      if (processed < requiredPerLevel) {
        return null;
      }

      levelStats[levelId] = { completed, failed, processed };
    }

    const totalCompleted = Object.values(levelStats).reduce((sum, item) => sum + item.completed, 0);
    const totalChallenges = levelIds.length * requiredPerLevel;
    const overallRate = Math.round((totalCompleted / totalChallenges) * 100);

    if (overallRate === 100) return 'perfect';
    if (overallRate === 0) return 'zero';
    if (overallRate >= 40 && overallRate <= 60) return 'balanced';
    return null;
  }

  function getProgressValue(tipo, progress) {
    if (tipo === 'xp') return progress.xp;
    if (tipo === 'level') return progress.level;
    if (tipo === 'challenges') return progress.completedChallenges.length;
    if (tipo === 'minigames') return progress.completedMinigames.length;
    if (tipo === 'failed_challenges') return progress.failedChallenges.length;
    if (tipo === 'combined') return progress.combined;
    if (tipo === 'logum_challenges') return progress.logumChallenges.length;
    return 0;
  }

  function buildAchievementCards(rawList, progress, extras = {}) {
    return (rawList || [])
      .map(achievement => {
        const tipo = achievement.tipo || achievement.type || '';
        const target = achievement.criterio_valor ?? achievement.target;
        const isSpecial = tipo === 'all_levels_performance' || tipo === 'ranking';

        let value = 0;
        let unlocked = false;
        let progressPercent = 0;

        if (tipo === 'all_levels_performance') {
          unlocked =
            (target === 100 && extras.allLevelsPerformance === 'perfect') ||
            (target === 'balanced' && extras.allLevelsPerformance === 'balanced') ||
            (target === 0 && extras.allLevelsPerformance === 'zero');
        } else if (tipo === 'ranking') {
          unlocked = Number(extras.rankingPosition || 0) === Number(target || 0);
        } else {
          value = getProgressValue(tipo, progress);
          progressPercent = typeof target === 'number' && target > 0
            ? Math.min(100, Math.round((value / target) * 100))
            : 0;
          unlocked = typeof target === 'number' ? value >= target : false;
        }

        return {
          ...achievement,
          value,
          progress: progressPercent,
          unlocked,
          isSpecial
        };
      })
      .sort((a, b) => {
        if (a.unlocked !== b.unlocked) {
          return a.unlocked ? -1 : 1;
        }
        return b.progress - a.progress;
      });
  }

  return {
    normalizeAchievementProgress,
    deriveAllLevelsPerformance,
    buildAchievementCards
  };
});
