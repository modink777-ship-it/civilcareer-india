/**
 * Legacy Morning Brief publisher retired. Scheduled publishing is handled by
 * the Social Engine and is limited to suggestions approved by an administrator.
 */
module.exports = function morningBriefHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  return res.status(410).json({
    error: 'Morning Brief direct publishing is retired. Use the approval-gated Social Engine.',
  });
};
