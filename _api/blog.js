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

module.exports = async function blog(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.statusCode = 200; res.end(); return; }

  const url  = new URL(req.url, 'http://localhost');
  const slug = url.searchParams.get('slug') || '';
  const cat  = url.searchParams.get('category') || '';
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = 12;

  // GET single post
  if (req.method === 'GET' && slug) {
    const { data, error } = await sb().from('blog_posts')
      .select('id,slug,title,meta_description,content,category,tags,published_at,views')
      .eq('slug', slug).eq('published', true).single();
    if (error || !data) return json(res, 404, { error: 'Post not found' });
    // Increment views
    sb().from('blog_posts').update({ views: (data.views || 0) + 1 }).eq('slug', slug).then(() => {});
    return json(res, 200, { post: data });
  }

  // GET list
  if (req.method === 'GET') {
    let q = sb().from('blog_posts')
      .select('id,slug,title,meta_description,category,tags,published_at,views', { count: 'exact' })
      .eq('published', true).order('published_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    if (cat) q = q.eq('category', cat);
    const { data, count, error } = await q;
    if (error) return json(res, 500, { error: error.message });
    return json(res, 200, { posts: data || [], total: count || 0, page, limit });
  }

  // Admin POST/PUT
  if (req.method === 'POST' || req.method === 'PUT') {
    let body = {};
    try { const raw = await new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); }); body = JSON.parse(raw); } catch {}
    if (!isAdmin(req, body)) return json(res, 401, { error: 'Unauthorized' });
    const { id, slug: s, title, meta_description, content, category, tags, published } = body;
    const row = {
      slug: s, title, meta_description, content, category,
      tags: Array.isArray(tags) ? tags : [],
      published: !!published,
      published_at: published ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    let error;
    if (id) {
      ({ error } = await sb().from('blog_posts').update(row).eq('id', id));
    } else {
      ({ error } = await sb().from('blog_posts').insert({ ...row, created_at: new Date().toISOString() }));
    }
    if (error) return json(res, 500, { error: error.message });
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: 'Method not allowed' });
};
