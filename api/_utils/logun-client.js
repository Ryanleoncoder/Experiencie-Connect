function apiDebugLog(...args) {
  if (process.env.CXGAME_DEBUG_API === 'true') {
    console.debug(...args);
  }
}

/**
 * HTTP client for Logun-IA text validation.
 * 2-layer fallback chain: Mistral (9s, 2 retries) → Rule Engine (2s).
 * Total budget: 8s (within Vercel's 10s limit, 2s buffer).
 */

const crypto = require('crypto');

class LogunIAClient {
  constructor(baseUrl, apiToken, timeout = 8000) {
    this.baseUrl = baseUrl;
    this.apiToken = apiToken;
    this.timeout = timeout;

    // 9s for Mistral (allows model warm-up), 2 retries, 2s for Rule Engine
    this.mistralTimeout = 9000;
    this.mistralRetries = 2;
    this.ruleEngineTimeout = 2000;
  }

  async validateText(payload) {
    const requestId = this.generateRequestId();
    
    apiDebugLog('[logun-client] Iniciando validação:', {
      challengeId: payload.challengeId,
      userId: payload.userId,
      level: payload.level,
      textLength: payload.text?.length,
      requestId
    });

    let lastMistralError = null;
    for (let attempt = 1; attempt <= this.mistralRetries; attempt++) {
      try {
        const startTime = Date.now();
        apiDebugLog(`[logun-client] Tentativa Mistral ${attempt}/${this.mistralRetries}:`, { requestId });
        
        const result = await this._callLogun(payload, requestId, this.mistralTimeout);
        const latency = Date.now() - startTime;
        
        apiDebugLog('[logun-client] Validação Mistral bem-sucedida:', {
          requestId,
          attempt,
          latency,
          provider: result.provider_used,
          status: result.status,
          confidence: result.confianca
        });
        
        return result;
      } catch (mistralError) {
        lastMistralError = mistralError;
        
        if (mistralError.message === 'timeout' && attempt < this.mistralRetries) {
          console.warn(`[logun-client] Timeout Mistral na tentativa ${attempt}, tentando novamente:`, {
            requestId,
            error: mistralError.message
          });
          continue;
        }

        console.warn(`[logun-client] Tentativa Mistral ${attempt} falhou:`, {
          requestId,
          error: mistralError.message,
          errorType: mistralError.name,
          willRetry: attempt < this.mistralRetries && mistralError.message === 'timeout'
        });
        
        if (attempt === this.mistralRetries) {
          break;
        }
      }
    }

    // All Mistral attempts failed, fallback to Rule Engine
    console.warn('[logun-client] All Mistral attempts failed, trying Rule Engine:', {
      requestId,
      error: lastMistralError?.message
    });

    try {
      const startTime = Date.now();
      const result = await this._callLogun(
        { ...payload, force_provider: 'rule_engine' },
        requestId,
        this.ruleEngineTimeout
      );
      const latency = Date.now() - startTime;
      
      apiDebugLog('[logun-client] Rule Engine validation succeeded:', {
        requestId,
        latency,
        provider: result.provider_used,
        status: result.status
      });
      
      return result;
    } catch (ruleEngineError) {
      console.error('[logun-client] All providers failed:', {
        requestId,
        mistralError: lastMistralError?.message,
        ruleEngineError: ruleEngineError.message
      });
      
      throw new Error('service_unavailable');
    }
  }

  async _callLogun(payload, requestId, timeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const requestPayload = this.buildPayload(payload);
      const headers = this.buildHeaders(requestId);

      apiDebugLog('[logun-client] Sending request to Logun-IA:', {
        url: this.baseUrl,
        requestId,
        timeout,
        payloadSize: JSON.stringify(requestPayload).length
      });

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[logun-client] Logun-IA returned error:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
          requestId
        });
        
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (!result.status || !result.confianca) {
        console.error('[logun-client] Invalid response structure:', {
          requestId,
          result
        });
        throw new Error('Invalid response structure from Logun-IA');
      }

      return result;

    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        console.warn('[logun-client] Request timeout:', {
          requestId,
          timeout
        });
        throw new Error('timeout');
      }

      console.error('[logun-client] Request failed:', {
        requestId,
        error: error.message,
        errorName: error.name
      });
      throw error;
    }
  }

  // Sends only challenge_id; Logun loads full context from its local cache on the VM.
  buildPayload(data) {
    return {
      text: data.text,
      challenge_id: data.challengeId,
      user_id: data.userId,
      challenge_level: data.level,
      force_provider: data.force_provider || undefined,
      model_choice: data.modelChoice || undefined
    };
  }

  buildHeaders(requestId) {
    return {
      'Authorization': `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
      'X-Origin-Service': 'validate-answer-api'
    };
  }

  generateRequestId() {
    return crypto.randomUUID();
  }
}

function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function generateCacheKey(challengeId, text) {
  const normalized = normalizeText(text);
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');
  return `logun:cache:${challengeId}:${hash}`;
}

module.exports = {
  LogunIAClient,
  normalizeText,
  generateCacheKey
};
