'use strict';
const { SITE_URL } = require('../lib/security');
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  res.setHeader('Cache-Control', 'no-store');
  // The anon key is intentionally public client configuration. Never expose
  // SUPABASE_SERVICE_ROLE_KEY here.
  const url = process.env.SUPABASE_URL || process.env.SUPABASE_PUBLIC_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLIC_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return res.status(503).json({ error: 'Authentication is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in Vercel Production environment variables.' });
  res.status(200).json({ url, anonKey: anon, siteUrl: SITE_URL });
};
