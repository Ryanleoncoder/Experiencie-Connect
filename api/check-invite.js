const { validateCORS } = require('./_middleware/cors');

module.exports = async (req, res) => {
  if (!validateCORS(req, res)) return;
  return res.status(410).json({
    error: 'legacy_invite_removed',
    message: 'Use a ativação por passkey.'
  });
};
