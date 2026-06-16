function apiDebugLog(...args) {
  if (process.env.CXGAME_DEBUG_API === 'true') {
    console.debug(...args);
  }
}

class CostControlManager {
  constructor(redis = null) {
    this.redis = redis;

    // All current providers are free — costs kept at 0 for future billing tracking
    this.providerCosts = {
      mistral: 0.00000,
      openrouter: 0.00000,
      gemini: 0.00000,
      rule_engine: 0.00000
    };
  }

  async trackValidation(provider, tokensUsed = 0) {
    if (!this.redis) {
      console.warn('[cost-control] Redis não disponível, pulando rastreamento');
      return;
    }

    try {
      const today = new Date().toISOString().split('T')[0];

      const totalKey = `logun:daily:total:${today}`;
      await this.redis.incr(totalKey);
      await this.redis.expire(totalKey, 86400 * 2);

      const providerKey = `logun:daily:provider:${provider}:${today}`;
      await this.redis.incr(providerKey);
      await this.redis.expire(providerKey, 86400 * 2);

      const cost = this.providerCosts[provider] || 0;
      if (cost > 0) {
        const costKey = `logun:cost:total:${today}`;
        await this.redis.incrbyfloat(costKey, cost);
        await this.redis.expire(costKey, 86400 * 2);
      }

      apiDebugLog('[cost-control] Validação rastreada:', {
        provider,
        tokensUsed,
        cost,
        date: today
      });

    } catch (error) {
      console.error('[cost-control] Erro ao rastrear validação:', error.message);
    }
  }

  async getCostMetrics() {
    if (!this.redis) {
      return {
        total_validations_today: 0,
        cost_estimate_usd_today: 0,
        avg_cost_per_validation: 0,
        provider_breakdown: {}
      };
    }

    try {
      const today = new Date().toISOString().split('T')[0];

      const totalKey = `logun:daily:total:${today}`;
      const totalValidations = parseInt(await this.redis.get(totalKey)) || 0;

      const costKey = `logun:cost:total:${today}`;
      const totalCost = parseFloat(await this.redis.get(costKey)) || 0;

      const providers = ['mistral', 'openrouter', 'gemini', 'rule_engine'];
      const providerBreakdown = {};

      for (const provider of providers) {
        const providerKey = `logun:daily:provider:${provider}:${today}`;
        const count = parseInt(await this.redis.get(providerKey)) || 0;
        providerBreakdown[provider] = count;
      }

      return {
        total_validations_today: totalValidations,
        cost_estimate_usd_today: totalCost,
        avg_cost_per_validation: totalValidations > 0 ? totalCost / totalValidations : 0,
        provider_breakdown: providerBreakdown,
        date: today
      };

    } catch (error) {
      console.error('[cost-control] Error getting metrics:', error.message);
      return {
        total_validations_today: 0,
        cost_estimate_usd_today: 0,
        avg_cost_per_validation: 0,
        provider_breakdown: {},
        error: error.message
      };
    }
  }

  async getMetricsForRange(startDate, endDate) {
    if (!this.redis) {
      return {
        total_validations: 0,
        total_cost_usd: 0,
        provider_breakdown: {}
      };
    }

    try {
      const start = new Date(startDate);
      const end = new Date(endDate);

      let totalValidations = 0;
      let totalCost = 0;
      const providerBreakdown = {
        mistral: 0,
        openrouter: 0,
        gemini: 0,
        rule_engine: 0
      };

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];

        const totalKey = `logun:daily:total:${dateStr}`;
        const dayTotal = parseInt(await this.redis.get(totalKey)) || 0;
        totalValidations += dayTotal;

        const costKey = `logun:cost:total:${dateStr}`;
        const dayCost = parseFloat(await this.redis.get(costKey)) || 0;
        totalCost += dayCost;

        for (const provider of Object.keys(providerBreakdown)) {
          const providerKey = `logun:daily:provider:${provider}:${dateStr}`;
          const count = parseInt(await this.redis.get(providerKey)) || 0;
          providerBreakdown[provider] += count;
        }
      }

      return {
        total_validations: totalValidations,
        total_cost_usd: totalCost,
        avg_cost_per_validation: totalValidations > 0 ? totalCost / totalValidations : 0,
        provider_breakdown: providerBreakdown,
        start_date: startDate,
        end_date: endDate
      };

    } catch (error) {
      console.error('[cost-control] Error getting range metrics:', error.message);
      return {
        total_validations: 0,
        total_cost_usd: 0,
        provider_breakdown: {},
        error: error.message
      };
    }
  }
}

module.exports = {
  CostControlManager
};
