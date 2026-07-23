const { validateCORS } = require('./_middleware/cors');


module.exports = async (req, res) => {
  if (!validateCORS(req, res)) return;
  return res.status(410).json({
    error: 'password_login_removed',
    message: 'Entre usando sua passkey.'
  });
};
