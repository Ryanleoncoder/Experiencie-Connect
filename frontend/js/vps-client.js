function vpsClientDebugLog(...args) {
  if (typeof window !== 'undefined' && window.CX_DEBUG === true) {
    console.debug(...args);
  }
}

/**
 * Cliente VPS - Manipula requisições ao VPS com fallback automático
 * 
 * Suporta múltiplos endpoints VPS (DuckDNS, No-IP, etc.) com failover automático.
 * Se um endpoint estiver bloqueado ou falhar, tenta automaticamente o próximo.
 * 
 * Uso:
 *   import { fetchFromVPS } from './vps-client.js';
 *   const data = await fetchFromVPS('/ranking/current');
 */

/**
 * Endpoints VPS em ordem de prioridade
 * Adicione No-IP ou outras alternativas aqui quando configuradas
 */
const VPS_ENDPOINTS = [
    'https://api.expconnect.com.br',
    // Adicione endpoint No-IP aqui quando pronto:
    // 'https://cxgameapi.ddns.net',
    // 'https://cxgameapi.mooo.com',
];

/**
 * Buscar do VPS com fallback automático
 * @param {object} options - Opções de fetch (method, headers, body, etc.)
 * @returns {Promise<Response>} Resposta do fetch
 */
async function fetchFromVPS(endpoint, options = {}) {
    const errors = [];
    
    // Garantir que endpoint comece com /
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    
    for (const baseUrl of VPS_ENDPOINTS) {
        try {
            vpsClientDebugLog(`[VPS Client] Tentando ${baseUrl}${normalizedEndpoint}`);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            
            const response = await fetch(`${baseUrl}${normalizedEndpoint}`, {
                ...options,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                vpsClientDebugLog(`[VPS Client] ✓ Sucesso com ${baseUrl}`);
                return response;
            }
            
            errors.push(`${baseUrl}: HTTP ${response.status}`);
            console.warn(`[VPS Client] ${baseUrl} retornou ${response.status}, tentando próximo...`);
            
        } catch (error) {
            errors.push(`${baseUrl}: ${error.message}`);
            console.warn(`[VPS Client] ${baseUrl} falhou: ${error.message}, tentando próximo...`);
        }
    }
    
    throw new Error(`Todos os endpoints VPS falharam: ${errors.join('; ')}`);
}

/**
 * Buscar JSON do VPS com fallback automático
 * @param {object} options - Opções de fetch
 * @returns {Promise<object>} Resposta JSON analisada
 */
async function fetchJSONFromVPS(endpoint, options = {}) {
    const response = await fetchFromVPS(endpoint, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...options.headers
        }
    });
    
    return await response.json();
}

/**
 * POST JSON para VPS com fallback automático
 * @param {object} data - Dados a enviar
 * @param {object} options - Opções adicionais de fetch
 * @returns {Promise<object>} Resposta JSON analisada
 */
async function postJSONToVPS(endpoint, data, options = {}) {
    return await fetchJSONFromVPS(endpoint, {
        ...options,
        method: 'POST',
        body: JSON.stringify(data)
    });
}

/**
 * GET JSON from VPS with automatic fallback
 * @returns {Promise<object>} Parsed JSON response
 */
async function getJSONFromVPS(endpoint, options = {}) {
    return await fetchJSONFromVPS(endpoint, {
        ...options,
        method: 'GET'
    });
}

// Exportar funções
if (typeof module !== 'undefined' && module.exports) {
    // Node.js / CommonJS
    module.exports = {
        fetchFromVPS,
        fetchJSONFromVPS,
        postJSONToVPS,
        getJSONFromVPS,
        VPS_ENDPOINTS
    };
} else {
    // Browser / Global
    window.VPSClient = {
        fetchFromVPS,
        fetchJSONFromVPS,
        postJSONToVPS,
        getJSONFromVPS,
        VPS_ENDPOINTS
    };
}
