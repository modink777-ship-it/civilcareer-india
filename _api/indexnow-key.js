'use strict';

/**
 * GET /api/indexnow-key.txt?key=<KEY> — the IndexNow protocol's ownership
 * proof: the response body is exactly the key string. Unset INDEXNOW_KEY
 * answers 404 (no information leaks about configuration).
 * The ?key= echo is mandatory — it prevents path-scanning enumeration of
 * the endpoint as a key oracle: without the correct key answering, the
 * engines never accept the file, so probing it reveals nothing.
 */

module.exports = async function handler(req, res) {
  const key = String(process.env.INDEXNOW_KEY || '').trim();
  if (!key) return res.status(404).send('');
  const url = new URL(req.url, 'http://localhost');
  const supplied = String(url.searchParams.get('key') || '');
  if (supplied !== key) return res.status(404).send('');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.status(200).send(key);
};
