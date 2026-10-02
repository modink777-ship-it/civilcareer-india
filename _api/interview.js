'use strict';

const { createClient } = require('@supabase/supabase-js');

const TABLE_SETUP_ERROR =
  'Interview questions table is not created yet. Run supabase-v26-blog-interview.sql in the Supabase SQL editor.';

function sb() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  );
}

function json(res, status, obj) {
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = status;
  res.end(JSON.stringify(obj));
}

function missingTable(error) {
  return /PGRST205|42P01|relation .* does not exist|Could not find the table/i.test(
    String(error?.message || error || '')
  );
}

function databaseFailure(res, operation, error) {
  if (missingTable(error)) return json(res, 503, { error: TABLE_SETUP_ERROR });
  console.error(`interview ${operation} failed:`, error?.message || 'Unknown database error');
  return json(res, 500, { error: `Failed to ${operation}. Please retry.` });
}

async function queryOrRespond(res, operation, query) {
  try {
    const result = await query();
    if (result.error) {
      databaseFailure(res, operation, result.error);
      return null;
    }
    return result;
  } catch (error) {
    databaseFailure(res, operation, error);
    return null;
  }
}

function ownerKey() {
  return process.env.OWNER_KEY || process.env.CIVILCAREER_OWNER_KEY;
}

function isAdmin(req, body) {
  const key = body?.key || req.headers['x-owner-key'];
  return Boolean(ownerKey() && key === ownerKey());
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const raw = await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return null;
  }
}

module.exports = async function interview(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  if (!process.env.SUPABASE_URL ||
      !(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY)) {
    return json(res, 503, { error: 'Interview API is not configured on this deployment.' });
  }

  const url = new URL(req.url, 'http://localhost');
  const action = url.searchParams.get('action') || '';
  const company = url.searchParams.get('company') || '';
  const role = url.searchParams.get('role') || '';
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const limit = 20;

  if (req.method === 'GET' && action !== 'approve') {
    const pendingOnly = url.searchParams.get('status') === 'pending';
    if (pendingOnly && !isAdmin(req, {})) {
      return json(res, 401, { error: 'Unauthorized' });
    }

    const result = await queryOrRespond(res, 'load interview questions', () => {
      let query = sb().from('interview_questions')
        .select('id,company,role,question,answer,difficulty,round,year,upvotes,created_at', { count: 'exact' })
        .eq('is_approved', !pendingOnly)
        .order('upvotes', { ascending: false })
        .range((page - 1) * limit, page * limit - 1);
      if (company) query = query.ilike('company', `%${company}%`);
      if (role) query = query.ilike('role', `%${role}%`);
      return query;
    });
    if (!result) return;
    return json(res, 200, { questions: result.data || [], total: result.count || 0, page, limit });
  }

  const body = await readBody(req);
  if (body === null) return json(res, 400, { error: 'Invalid JSON body.' });

  if (req.method === 'POST' && action === 'upvote') {
    const { id } = body;
    if (!id) return json(res, 400, { error: 'id required' });
    const found = await queryOrRespond(res, 'load interview question', () =>
      sb().from('interview_questions').select('upvotes').eq('id', id).single()
    );
    if (!found) return;
    const updated = await queryOrRespond(res, 'update interview question', () =>
      sb().from('interview_questions').update({ upvotes: (found.data?.upvotes || 0) + 1 }).eq('id', id)
    );
    if (!updated) return;
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && action !== 'approve') {
    const { company: companyName, role: jobRole, question, answer, difficulty, round, year } = body;
    if (!companyName || !question) {
      return json(res, 400, { error: 'company and question required' });
    }
    const inserted = await queryOrRespond(res, 'submit interview question', () =>
      sb().from('interview_questions').insert({
        company: companyName,
        role: jobRole || '',
        question,
        answer: answer || '',
        difficulty: difficulty || 'medium',
        round: round || 'Technical',
        year: year || new Date().getFullYear(),
        is_approved: false,
        upvotes: 0,
        created_at: new Date().toISOString(),
      })
    );
    if (!inserted) return;
    return json(res, 200, { ok: true, message: 'Submitted for review. Thank you!' });
  }

  if (req.method === 'POST' && action === 'approve') {
    if (!isAdmin(req, body)) return json(res, 401, { error: 'Unauthorized' });
    const { id, approved } = body;
    if (!id) return json(res, 400, { error: 'id required' });
    const updated = await queryOrRespond(res, 'moderate interview question', () =>
      sb().from('interview_questions').update({ is_approved: !!approved }).eq('id', id)
    );
    if (!updated) return;
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: 'Method not allowed' });
};
