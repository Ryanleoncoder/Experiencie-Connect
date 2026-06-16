function apiDebugLog(...args) {
  if (process.env.CXGAME_DEBUG_API === 'true') {
    console.debug(...args);
  }
}

/**
 * Validates platform access against platform_config in Supabase.
 * Blocks on: maintenance, platform disabled, season closed/archived, outside event window (07h-19h BRT).
 *
 * Architecture: VPS scheduler updates is_open in Supabase at 07h and 19h;
 * this middleware reads that flag. Frontend redirects to the appropriate status screen.
 *
 * BYPASS_EVENT_WINDOW=true allows testing outside hours (dev/staging only).
 */

const { createClient } = require('@supabase/supabase-js');

const configCache = {
  data: null,
  timestamp: 0,
  ttl: 60 * 1000 // 1 minute
};

async function validatePlatformAccess(req, res) {
  try {
    const config = await getPlatformConfig();

    // NEVER enable BYPASS_EVENT_WINDOW in production
    const bypass = process.env.BYPASS_EVENT_WINDOW === 'true';
    
    if (bypass) {
      apiDebugLog('[Platform Access] ⚠️ BYPASS_EVENT_WINDOW is enabled - skipping event window check');
    }
    
    if (config.maintenance_mode?.enabled) {
      return {
        allowed: false,
        reason: 'maintenance',
        message: config.maintenance_mode.message || 'Plataforma em manutenção',
        redirect: '/maintenance.html'
      };
    }
    
    if (!config.platform_enabled) {
      return {
        allowed: false,
        reason: 'platform_disabled',
        message: 'Plataforma temporariamente indisponível',
        redirect: '/maintenance.html'
      };
    }
    
    if (['CLOSED', 'ARCHIVED'].includes(config.season_state?.status)) {
      return {
        allowed: false,
        reason: 'season_closed',
        message: 'Temporada encerrada',
        redirect: '/season-closed.html'
      };
    }
    
    if (!bypass && !config.event_window?.is_open) {
      return {
        allowed: false,
        reason: 'outside_window',
        message: 'Fora do horário de funcionamento (07h-19h)',
        redirect: '/outside-window.html',
        next_open_time: getNextOpenTime(config.event_window)
      };
    }
    
    return {
      allowed: true,
      bypass_active: bypass
    };
    
  } catch (error) {
    console.error('[Platform Access] Error validating access:', error);
    
    // Fail open: infrastructure failures should not block legitimate users
    return {
      allowed: true,
      error: 'Validation failed, allowing access (fail-open)',
      details: error.message
    };
  }
}

async function getPlatformConfig() {
  const now = Date.now();
  if (configCache.data && (now - configCache.timestamp) < configCache.ttl) {
    apiDebugLog('[Platform Access] Using cached config');
    return configCache.data;
  }
  
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  const { data: configs, error } = await supabase
    .from('platform_config')
    .select('key, value')
    .in('key', ['platform_enabled', 'event_window', 'season_state', 'maintenance_mode']);
  
  if (error) {
    console.error('[Platform Access] Supabase error:', error);
    throw new Error(`Failed to fetch platform config: ${error.message}`);
  }
  
  const configMap = {
    platform_enabled: true, // Default to enabled
    event_window: {
      is_open: false,
      open_time: '07:00',
      close_time: '19:00',
      timezone: 'America/Sao_Paulo',
      enabled: true
    },
    season_state: { status: 'ACTIVE' },
    maintenance_mode: { enabled: false, message: '' }
  };
  
  if (configs && configs.length > 0) {
    configs.forEach(config => {
      if (config.key === 'platform_enabled') {
        configMap.platform_enabled = config.value === true || config.value === 'true';
      } else {
        configMap[config.key] = config.value;
      }
    });
  }
  
  configCache.data = configMap;
  configCache.timestamp = now;
  
  apiDebugLog('[Platform Access] Config fetched from Supabase:', {
    platform_enabled: configMap.platform_enabled,
    is_open: configMap.event_window?.is_open,
    season_status: configMap.season_state?.status,
    maintenance: configMap.maintenance_mode?.enabled
  });
  
  return configMap;
}

function getNextOpenTime(eventWindow) {
  if (!eventWindow) return null;
  
  const now = new Date();

  const [openHour, openMinute] = (eventWindow.open_time || '07:00').split(':').map(Number);

  // BRT is UTC-3, so 07:00 BRT = 10:00 UTC
  const nextOpen = new Date(now);
  nextOpen.setUTCHours(openHour + 3, openMinute, 0, 0);
  
  // If we're past today's open time, move to tomorrow
  if (now >= nextOpen) {
    nextOpen.setUTCDate(nextOpen.getUTCDate() + 1);
  }
  
  return nextOpen.toISOString();
}

function clearConfigCache() {
  configCache.data = null;
  configCache.timestamp = 0;
}

module.exports = {
  validatePlatformAccess,
  clearConfigCache
};
