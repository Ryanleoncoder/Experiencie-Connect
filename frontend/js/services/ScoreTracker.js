/**
 * ScoreTracker - Manages scoring for intermission games
 * 
 * Calculates scores based on:
 * - Correctness: Base score from correct answers
 * - Time bonus: Up to 20% bonus for fast completion
 * - Hint penalties: -10% per hint used
 * 
 * Score to XP conversion:
 * - 200 points = 40 XP
 * - 150-199 points = 30 XP
 * - 100-149 points = 20 XP
 * - 50-99 points = 10 XP
 * - 0-49 points = 5 XP
 * 
 */
(function initScoreTracker(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ScoreTracker = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function buildScoreTracker() {
  
  /**
   * ScoreTracker class
   * Manages score calculation and XP conversion for intermission games
   */
  class ScoreTracker {
    constructor(maxScore = 200) {
      this.maxScore = maxScore;
      this.baseScore = 0;
      this.timeBonus = 0;
      this.hintDeduction = 0;
      this.finalScore = 0;
      this.hintsUsed = 0;
      this.hintPenaltyRate = 0.1; // 10% per hint
      this.timeBonusRate = 0.2; // Max 20% bonus
      this.startTime = null;
      this.endTime = null;
      this.timeSpent = 0;
    }

    /**
     * Start the timer for the game
     */
    startTimer() {
      this.startTime = Date.now();
    }

    /**
     * Stop the timer and calculate time spent
     * @returns {number} Time spent in seconds
     */
    stopTimer() {
      if (!this.startTime) {
        console.warn('[ScoreTracker] Timer was not started');
        return 0;
      }
      
      this.endTime = Date.now();
      this.timeSpent = Math.round((this.endTime - this.startTime) / 1000);
      return this.timeSpent;
    }

    /**
     * Get current time spent (without stopping timer)
     * @returns {number} Time spent in seconds
     */
    getCurrentTime() {
      if (!this.startTime) {
        return 0;
      }
      
      const now = Date.now();
      return Math.round((now - this.startTime) / 1000);
    }

    /**
     * Calculate time bonus based on time spent
     * @param {number} timeSpent - Time spent in seconds
     * @param {number} optimalTime - Optimal completion time in seconds (default: 60)
     * @returns {number} Time bonus points
     */
    calculateTimeBonus(timeSpent, optimalTime = 60) {
      // No bonus if time exceeds optimal time
      if (timeSpent >= optimalTime) {
        return 0;
      }
      
      const timeFactor = (optimalTime - timeSpent) / optimalTime;

      const bonus = Math.round(this.maxScore * this.timeBonusRate * timeFactor);
      
      return Math.max(0, bonus);
    }

    /**
     * Calculate hint deduction based on hints used
     * @param {number} baseScore - Base score before penalties
     * @param {number} hintsUsed - Number of hints used
     * @returns {number} Hint deduction points
     */
    calculateHintDeduction(baseScore, hintsUsed) {
      if (hintsUsed <= 0) {
        return 0;
      }
      
      // Calculate deduction (10% per hint)
      const deduction = Math.round(baseScore * this.hintPenaltyRate * hintsUsed);
      
      return Math.max(0, deduction);
    }

    /**
     * Calculate final score based on correctness, time, and hints
     * @param {number} timeSpent - Time spent in seconds
     * @param {number} hintsUsed - Number of hints used
     * @param {number} optimalTime - Optimal completion time (default: 60)
     * @returns {Object} Score breakdown
     */
    calculateScore(correct, total, timeSpent, hintsUsed, optimalTime = 60) {
      // Validate inputs
      if (total <= 0) {
        throw new Error('Total must be greater than 0');
      }
      
      if (correct < 0 || correct > total) {
        throw new Error('Correct must be between 0 and total');
      }
      
      if (timeSpent < 0) {
        throw new Error('Time spent cannot be negative');
      }
      
      if (hintsUsed < 0) {
        throw new Error('Hints used cannot be negative');
      }
      
      const correctnessRatio = correct / total;
      this.baseScore = Math.round(this.maxScore * correctnessRatio);

      this.timeBonus = this.calculateTimeBonus(timeSpent, optimalTime);
      
      // Calculate hint deduction
      this.hintsUsed = hintsUsed;
      this.hintDeduction = this.calculateHintDeduction(this.baseScore, hintsUsed);
      
      // Calculate final score (ensure non-negative)
      this.finalScore = Math.max(0, this.baseScore + this.timeBonus - this.hintDeduction);
      
      // Store time spent
      this.timeSpent = timeSpent;
      
      // Calculate percentage
      const percentage = Math.round((this.finalScore / this.maxScore) * 100);
      
      return {
        baseScore: this.baseScore,
        timeBonus: this.timeBonus,
        hintDeduction: this.hintDeduction,
        finalScore: this.finalScore,
        percentage,
        correct,
        total,
        timeSpent,
        hintsUsed
      };
    }

    /**
     * Convert score to XP based on score ranges
     * @returns {number} XP earned
     */
    convertToXP(score) {
      if (score >= 200) return 40;
      if (score >= 150) return 30;
      if (score >= 100) return 20;
      if (score >= 50) return 10;
      return 5;
    }

    /**
     * Get XP for current final score
     * @returns {number} XP earned
     */
    getXP() {
      return this.convertToXP(this.finalScore);
    }

    /**
     * Get score breakdown for display
     * @returns {Object} Score breakdown
     */
    getBreakdown() {
      return {
        baseScore: this.baseScore,
        timeBonus: this.timeBonus,
        hintDeduction: this.hintDeduction,
        finalScore: this.finalScore,
        hintsUsed: this.hintsUsed
      };
    }

    /**
     * Get complete score summary
     * @returns {Object} Complete score breakdown with XP
     */
    getScoreSummary() {
      const xpEarned = this.getXP();
      const percentage = Math.round((this.finalScore / this.maxScore) * 100);
      
      return {
        baseScore: this.baseScore,
        timeBonus: this.timeBonus,
        hintDeduction: this.hintDeduction,
        finalScore: this.finalScore,
        percentage,
        xpEarned,
        maxScore: this.maxScore,
        timeSpent: this.timeSpent,
        hintsUsed: this.hintsUsed
      };
    }

    /**
     * Get performance classification based on percentage
     * @returns {Object} Performance data with emoji, title, and color
     */
    getPerformanceClassification(percentage) {
      if (percentage >= 100) {
        return {
          emoji: '🏆',
          title: 'Perfeito!',
          color: '#FFB800'
        };
      }
      
      if (percentage >= 75) {
        return {
          emoji: '👏',
          title: 'Quase Lá!',
          color: '#60a5fa'
        };
      }
      
      if (percentage >= 50) {
        return {
          emoji: '📈',
          title: 'Pode Melhorar',
          color: '#22c55e'
        };
      }
      
      return {
        emoji: '📚',
        title: 'Revise os Conceitos',
        color: '#f97316'
      };
    }

    /**
     * Get complete result data for result screen
     * @returns {Object} Complete result data
     */
    getResultData() {
      const summary = this.getScoreSummary();
      const performance = this.getPerformanceClassification(summary.percentage);
      
      return {
        ...summary,
        ...performance
      };
    }

    /**
     * Reset the score tracker for a new game
     */
    reset() {
      this.baseScore = 0;
      this.timeBonus = 0;
      this.hintDeduction = 0;
      this.finalScore = 0;
      this.hintsUsed = 0;
      this.startTime = null;
      this.endTime = null;
      this.timeSpent = 0;
    }
  }

  return ScoreTracker;
});
