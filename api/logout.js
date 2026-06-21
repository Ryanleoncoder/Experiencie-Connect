const { validateCORS } = require('./_middleware/cors');
const { buildClearCookies } = require('./_utils/cookies');

module.exports = async (req, res) => {
  if (!validateCORS(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  res.setHeader('Set-Cookie', buildClearCookies());
  return res.status(200).json({ success: true });
};
