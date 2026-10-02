/**
 * Legacy direct-publish route retired in favor of the approval-gated
 * Social Content Engine.
 */
module.exports = function telegramHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  return res.status(410).json({
    error: 'Direct Telegram posting is retired. Queue content in the admin Social tab and approve it before publishing.',
  });
};
