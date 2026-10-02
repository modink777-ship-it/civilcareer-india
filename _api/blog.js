'use strict';

const TABLE_SETUP_ERROR =
  'Blog posts table is not created yet. Run supabase-v26-blog-interview.sql in the Supabase SQL editor.';

function json(res, status, obj) {
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = status;
  res.end(JSON.stringify(obj));
}

function ownerKey() {
  return process.env.OWNER_KEY || process.env.CIVILCAREER_OWNER_KEY;
}

function isAdmin(req, body) {
  const key = body?.key || req.headers['x-owner-key'];
  return Boolean(ownerKey() && key === ownerKey());
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return null; }
  }
  return {};
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function blogRequest(params, options = {}) {
  const baseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const query = params instanceof URLSearchParams ? params.toString() : String(params || '');
  const url = `${baseUrl}/rest/v1/blog_posts${query ? `?${query}` : ''}`;
  return fetch(url, {
    method: options.method || 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {}),
    },
    body: options.body,
  }).then(async response => {
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) {}
    if (!response.ok) {
      return {
        error: {
          code: data && data.code,
          message: data && data.message ? data.message : text || `Supabase returned HTTP ${response.status}`,
        },
      };
    }
    const range = response.headers && response.headers.get('content-range');
    const count = range && range.includes('/')
      ? Number.parseInt(range.split('/').pop(), 10)
      : null;
    return { data, count: Number.isFinite(count) ? count : null };
  });
}

function databaseError(res, error) {
  const message = String(error?.message || error || '');
  if (/PGRST205|42P01|relation .* does not exist|Could not find the table/i.test(message)) {
    json(res, 503, { error: TABLE_SETUP_ERROR });
    return;
  }
  console.error('blog API failed:', message || 'Unknown database error');
  json(res, 500, { error: 'Failed to process blog request. Please retry.' });
}

function publicPost(row) {
  return {
    ...row,
    meta_description: row.excerpt || '',
    published_at: row.created_at || null,
  };
}

async function readJson(result, res) {
  if (result.error) {
    databaseError(res, result.error);
    return null;
  }
  return result;
}

module.exports = async function blog(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  const baseUrl = String(process.env.SUPABASE_URL || '').trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!baseUrl || !key) {
    return json(res, 503, { error: 'Blog API is not configured on this deployment.' });
  }

  const url = new URL(req.url, 'http://localhost');
  const slug = url.searchParams.get('slug') || '';
  const category = url.searchParams.get('category') || '';
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const limit = 12;
  const body = parseBody(req);
  if (body === null) return json(res, 400, { error: 'Invalid JSON body.' });

  try {
    if (req.method === 'GET') {
      const admin = isAdmin(req, body);
      const params = new URLSearchParams({
        select: 'id,slug,title,excerpt,content,category,author,tags,is_published,views,created_at,updated_at',
        order: 'created_at.desc',
      });
      if (!admin) params.set('is_published', 'eq.true');
      if (slug) {
        params.set('slug', `eq.${slug}`);
        params.set('limit', '1');
        const result = await readJson(await blogRequest(params), res);
        if (!result) return;
        const post = Array.isArray(result.data) ? result.data[0] : null;
        if (!post || (!admin && !post.is_published)) return json(res, 404, { error: 'Post not found' });
        if (!admin) {
          const viewed = await blogRequest(new URLSearchParams({ id: `eq.${post.id}` }), {
            method: 'PATCH',
            body: JSON.stringify({ views: (post.views || 0) + 1 }),
          });
          if (viewed.error) {
            console.error('blog views update failed:', viewed.error.message || 'Unknown database error');
          }
        }
        return json(res, 200, { post: publicPost(post) });
      }

      if (category) params.set('category', `eq.${category}`);
      params.set('offset', String((page - 1) * limit));
      params.set('limit', String(limit));
      const result = await readJson(await blogRequest(params, {
        headers: { Prefer: 'count=exact' },
      }), res);
      if (!result) return;
      const posts = Array.isArray(result.data) ? result.data : [];
      return json(res, 200, {
        posts: posts.map(publicPost),
        total: result.count || 0,
        page,
        limit,
      });
    }

    if (req.method === 'POST') {
      if (!isAdmin(req, body)) return json(res, 401, { error: 'Unauthorized' });
      const title = String(body.title || '').trim().slice(0, 200);
      const slugValue = slugify(body.slug || title);
      if (!title || !slugValue) return json(res, 400, { error: 'Title and a valid slug are required.' });

      const tags = Array.isArray(body.tags)
        ? body.tags.map(tag => String(tag).trim()).filter(Boolean)
        : String(body.tags || '').split(',').map(tag => tag.trim()).filter(Boolean);
      const isPublished = Boolean(body.is_published);
      const row = {
        slug: slugValue,
        title,
        excerpt: String(body.excerpt || '').trim().slice(0, 500) || null,
        content: String(body.content || ''),
        category: String(body.category || 'Career').trim().slice(0, 60),
        author: String(body.author || 'CivilCareer Team').trim().slice(0, 100),
        tags,
        is_published: isPublished,
        updated_at: new Date().toISOString(),
      };

      const previousSlug = slugify(body.previous_slug || slugValue);
      const existing = await readJson(await blogRequest(new URLSearchParams({
        select: 'id,created_at',
        slug: `eq.${previousSlug}`,
        limit: '1',
      })), res);
      if (!existing) return;
      const current = Array.isArray(existing.data) ? existing.data[0] : null;
      if (current) {
        const updated = await readJson(await blogRequest(new URLSearchParams({
          id: `eq.${current.id}`,
        }), {
          method: 'PATCH',
          body: JSON.stringify(row),
        }), res);
        if (!updated) return;
      } else {
        row.created_at = new Date().toISOString();
        const inserted = await readJson(await blogRequest('', {
          method: 'POST',
          body: JSON.stringify(row),
        }), res);
        if (!inserted) return;
      }
      return json(res, 200, { ok: true });
    }

    if (req.method === 'DELETE') {
      if (!isAdmin(req, body)) return json(res, 401, { error: 'Unauthorized' });
      if (!slug) return json(res, 400, { error: 'slug is required.' });
      const deleted = await readJson(await blogRequest(new URLSearchParams({
        slug: `eq.${slug}`,
      }), { method: 'DELETE' }), res);
      if (!deleted) return;
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    databaseError(res, error);
  }
};
