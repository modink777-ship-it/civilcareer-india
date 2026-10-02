/**
 * CivilCareer — Social graphics endpoint
 *
 * Phase 1 stub only. Deterministic SVG graphics are implemented in Phase 3.
 * This endpoint exists now so the dispatcher/API contract is stable.
 */
module.exports = async function socialGraphics(req, res) {
  res.statusCode = 501;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    ok: false,
    status: 'NOT CONFIGURED',
    message: 'Social graphics are not enabled in Phase 1. Deterministic SVG graphics are planned for Phase 3.',
  }));
};
