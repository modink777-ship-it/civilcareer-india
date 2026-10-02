'use strict';
const { createClient } = require('@supabase/supabase-js');
const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);

function json(res, status, obj) {
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = status;
  res.end(JSON.stringify(obj));
}

module.exports = async function mockTests(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.statusCode = 200; res.end(); return; }

  const url = new URL(req.url, 'http://localhost');
  const action = url.searchParams.get('action') || '';
  const exam   = url.searchParams.get('exam') || 'SSC_JE';
  const subject= url.searchParams.get('subject') || 'all';
  const limit  = Math.min(parseInt(url.searchParams.get('limit') || '100'), 100);

  // GET — fetch questions
  if (req.method === 'GET' && !action) {
    let q = sb().from('mock_questions').select('id,question,option_a,option_b,option_c,option_d,subject,difficulty,year').eq('exam', exam).eq('is_active', true);
    if (subject !== 'all') q = q.eq('subject', subject);
    const { data, error } = await q.limit(limit);
    if (error) return json(res, 500, { error: error.message });
    // Shuffle
    const shuffled = (data || []).sort(() => Math.random() - 0.5);
    return json(res, 200, { questions: shuffled, total: shuffled.length });
  }

  // GET answers (after submission)
  if (req.method === 'GET' && action === 'answers') {
    const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean);
    if (!ids.length) return json(res, 400, { error: 'ids required' });
    const { data, error } = await sb().from('mock_questions').select('id,correct_answer,explanation,question,option_a,option_b,option_c,option_d').in('id', ids);
    if (error) return json(res, 500, { error: error.message });
    return json(res, 200, { answers: data || [] });
  }

  // GET stats
  if (req.method === 'GET' && action === 'stats') {
    const { count } = await sb().from('mock_sessions').select('*', { count: 'exact', head: true }).eq('exam', exam);
    const { data: avgData } = await sb().from('mock_sessions').select('score,total').eq('exam', exam).not('score', 'is', null).limit(1000);
    const avg = avgData && avgData.length ? Math.round(avgData.reduce((s, r) => s + (r.score / r.total * 100), 0) / avgData.length) : 0;
    return json(res, 200, { attempts: count || 0, average_percent: avg });
  }

  // POST — save session result
  if (req.method === 'POST') {
    let body = {};
    try { const raw = await new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); }); body = JSON.parse(raw); } catch {}
    const { session_key, exam: e, answers, score, total } = body;
    if (!session_key) return json(res, 400, { error: 'session_key required' });
    const { error } = await sb().from('mock_sessions').upsert({
      session_key, exam: e || 'SSC_JE', answers: answers || {}, score: score ?? null, total: total ?? null,
      completed_at: score != null ? new Date().toISOString() : null,
    }, { onConflict: 'session_key' });
    if (error) return json(res, 500, { error: error.message });
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: 'Method not allowed' });
};
