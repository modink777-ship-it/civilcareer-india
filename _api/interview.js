'use strict';
const { createClient } = require('@supabase/supabase-js');
const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);

function json(res, status, obj) {
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = status;
  res.end(JSON.stringify(obj));
}

function ownerKey() { return process.env.OWNER_KEY || process.env.CIVILCAREER_OWNER_KEY; }
function isAdmin(req, body) {
  const k = body?.key || req.headers['x-owner-key'];
  return ownerKey() && k === ownerKey();
}

module.exports = async function interview(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.statusCode = 200; res.end(); return; }

  const url     = new URL(req.url, 'http://localhost');
  const action  = url.searchParams.get('action') || '';
  const company = url.searchParams.get('company') || '';
  const role    = url.searchParams.get('role') || '';
  const page    = parseInt(url.searchParams.get('page') || '1');
  const limit   = 20;

  // GET questions
  if (req.method === 'GET' && action !== 'approve') {
    let q = sb().from('interview_questions')
      .select('id,company,role,question,answer,difficulty,round,year,upvotes', { count: 'exact' })
      .eq('is_approved', true)
      .order('upvotes', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    if (company) q = q.ilike('company', `%${company}%`);
    if (role)    q = q.ilike('role', `%${role}%`);
    const { data, count, error } = await q;
    if (error) return json(res, 500, { error: error.message });
    return json(res, 200, { questions: data || [], total: count || 0, page, limit });
  }

  let body = {};
  try { const raw = await new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); }); body = JSON.parse(raw); } catch {}

  // POST upvote
  if (req.method === 'POST' && action === 'upvote') {
    const { id } = body;
    if (!id) return json(res, 400, { error: 'id required' });
    const { data } = await sb().from('interview_questions').select('upvotes').eq('id', id).single();
    await sb().from('interview_questions').update({ upvotes: (data?.upvotes || 0) + 1 }).eq('id', id);
    return json(res, 200, { ok: true });
  }

  // POST submit question
  if (req.method === 'POST' && action !== 'approve') {
    const { company: c, role: r, question, answer, difficulty, round, year } = body;
    if (!c || !question) return json(res, 400, { error: 'company and question required' });
    const { error } = await sb().from('interview_questions').insert({
      company: c, role: r || '', question, answer: answer || '',
      difficulty: difficulty || 'medium', round: round || 'Technical',
      year: year || new Date().getFullYear(),
      is_approved: false, upvotes: 0, created_at: new Date().toISOString(),
    });
    if (error) return json(res, 500, { error: error.message });
    return json(res, 200, { ok: true, message: 'Submitted for review. Thank you!' });
  }

  // POST approve (admin)
  if (req.method === 'POST' && action === 'approve') {
    if (!isAdmin(req, body)) return json(res, 401, { error: 'Unauthorized' });
    const { id, approved } = body;
    const { error } = await sb().from('interview_questions').update({ is_approved: !!approved }).eq('id', id);
    if (error) return json(res, 500, { error: error.message });
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: 'Method not allowed' });
};
