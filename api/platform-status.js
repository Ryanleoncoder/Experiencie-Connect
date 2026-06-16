
const { validatePlatformAccess } = require('./_middleware/platform-access');
const { validateCORS } = require('./_middleware/cors');

module.exports = async (req, res) => {
  if (!validateCORS(req, res)) {
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

  try {
    const access = await validatePlatformAccess(req, res);
    
    return res.status(200).json({
      allowed: access.allowed,
      reason: access.reason || null,
      message: access.message || null,
      redirect: access.redirect || null,
      next_open_time: access.next_open_time || null,
      bypass_active: access.bypass_active || false,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[Platform Status] Error:', error.message);

    return res.status(503).json({
      allowed: true,
      error: 'platform_status_unavailable',
      message: 'Status temporariamente indisponivel.',
      retryable: true,
      timestamp: new Date().toISOString()
    });
  }
};
