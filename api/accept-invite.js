const { validateCORS } = require('./_middleware/cors');

// This endpoint used to accept a password. Account activation now happens on
// the VPS after link + code + WebAuthn, so this legacy route must never revive.
module.exports = async (req, res) => {
  if (!validateCORS(req, res)) return;
  return res.status(410).json({
    error: 'password_activation_removed',
    message: 'Use o link de ativação e crie sua passkey.'
  });
};
