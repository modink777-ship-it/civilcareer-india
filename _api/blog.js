/**
 * CivilCareer — Blog API (Feature C)
 *
 * PUBLIC (no auth)
 *   GET              → list of published posts
 *                      (title, slug, category, author, tags, excerpt,
 *                       date, views) — newest first
 *   GET ?slug=xxx    → single published post (full content) + views counter
 *                      is incremented (best-effort, never blocks the read)
 *
 * ADMIN (x-owner-key — dashboard sessions are elevated by the dispatcher's
 *        ADMIN_RULES bridge, direct scripts can send the key themselves)
 *   GET (with key)   → ALL posts incl. drafts
 *   POST             → create or update a post (upsert on slug)
 *                      { title, slug?, excerpt?, content?, category?,
 *                        author?, tags?, is_published }
 *   DELETE ?slug=xxx → delete a post
 *
 * Table: blog_posts (see supabase-v26-blog-interview.sql)
 */

const SUPA = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

const { allowPublicCors, requireOwner } = require('../lib/security');
const { rateLimit } = require('../lib/rate-limit');

const CATEGORIES = ['Career', 'Exams', 'Interviews', 'Salary', 'Technology', 'News'];
const MAX_TAGS = 8;

function j(res, code, obj) {
  return res.status(code).json(obj);
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return {};
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function cleanTags(value) {
  const arr = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(arr.map((t) => cleanText(t, 40)).filter(Boolean))].slice(0, MAX_TAGS);
}

function supa(path, opts = {}) {
  return fetch(`${SUPA}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
}

async function readJson(res) {
  const t = await res.text();
  if (!res.ok) throw new Error(t || `Supabase ${res.status}`);
  return t ? JSON.parse(t) : [];
}

function isSetupError(detail) {
  return /PGRST205|relation .* does not exist|Could not find the table/i.test(String(detail || ''));
}

function summaryRow(r) {
  return {
    title: r.title,
    slug: r.slug,
    category: r.category,
    author: r.author,
    tags: r.tags || [],
    excerpt: r.excerpt,
    is_published: r.is_published,
    views: r.views || 0,
    updated_at: r.updated_at || r.created_at,
  };
}

/* ══════════════════════════ HANDLER ══════════════════════════ */

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    allowPublicCors(req, res);
    return res.status(204).end();
  }
  if (!SUPA || !KEY) {
    return j(res, 500, { error: 'Supabase server configuration is missing' });
  }

  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams;
  const body = parseBody(req);
  const wantsAdmin =
    Boolean(req.headers['x-owner-key']) || (req.method !== 'GET' && Boolean(body.key));

  try {
    /* ── ADMIN GET — every post incl. drafts ─────────────────── */
    if (req.method === 'GET' && wantsAdmin) {
      if (!requireOwner(req, res)) return;
      const rows = await readJson(await supa('blog_posts?select=*&order=updated_at.desc&limit=500'));
      return j(res, 200, { posts: rows });
    }

    /* ── PUBLIC GET — list or single post ────────────────────── */
    if (req.method === 'GET') {
      const slug = cleanText(q.get('slug'), 90);
      if (slug) {
        const rows = await readJson(
          await supa(`blog_posts?select=*&slug=eq.${encodeURIComponent(slug)}&limit=1`)
        );
        const post = rows[0];
        /* RLS exposes only published posts to anon reads; a missing row for a
           slug that an admin query CAN see means "draft" — same 404 publicly. */
        if (!post) return j(res, 404, { error: 'Post not found' });

        /* View counter — best-effort, rate-limited per IP, never blocks. */
        if (rateLimit(req, { windowMs: 60 * 60 * 1000, max: 60, key: 'blog-view' })) {
          supa(`blog_posts?id=eq.${post.id}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ views: (Number(post.views) || 0) + 1 }),
          }).catch(() => {});
        }
        return j(res, 200, { post });
      }

      const category = cleanText(q.get('category'), 40);
      const limit = Math.min(Math.max(parseInt(q.get('limit') || '50', 10) || 50, 1), 100);
      let path = `blog_posts?select=title,slug,category,author,tags,excerpt,is_published,views,created_at,updated_at&is_published=eq.true&order=created_at.desc&limit=${limit}`;
      if (category) path += `&category=eq.${encodeURIComponent(category)}`;
      const rows = await readJson(await supa(path));
      return j(res, 200, {
        posts: rows.map(summaryRow),
        categories: CATEGORIES,
      });
    }

    /* ── ADMIN POST — create / update (upsert on slug) ───────── */
    if (req.method === 'POST') {
      if (!requireOwner(req, res)) return;

      const title = cleanText(body.title, 160);
      if (!title) return j(res, 400, { error: 'Title is required' });

      const slug = slugify(body.slug || title);
      if (!slug) return j(res, 400, { error: 'Slug is required' });

      const content = String(body.content ?? '').slice(0, 60000);
      const category = CATEGORIES.includes(body.category) ? body.category : 'Career';

      const payload = {
        title,
        slug,
        excerpt: cleanText(body.excerpt, 400) || content.replace(/\s+/g, ' ').slice(0, 240),
        content,
        category,
        author: cleanText(body.author, 80) || 'CivilCareer Team',
        tags: cleanTags(body.tags),
        is_published: Boolean(body.is_published),
        updated_at: new Date().toISOString(),
      };

      /* Slug collision with a DIFFERENT post → update that one (admin intent:
         re-publishing an edited article), otherwise insert. */
      const existing = await readJson(
        await supa(`blog_posts?select=id&slug=eq.${encodeURIComponent(slug)}&limit=1`)
      );
      let saved;
      if (existing.length) {
        saved = await readJson(
          await supa(`blog_posts?id=eq.${existing[0].id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        );
      } else {
        saved = await readJson(await supa('blog_posts', { method: 'POST', body: JSON.stringify(payload) }));
      }
      return j(res, 200, { ok: true, post: saved[0] || payload });
    }

    /* ── ADMIN DELETE ─────────────────────────────────────────── */
    if (req.method === 'DELETE') {
      if (!requireOwner(req, res)) return;
      const slug = cleanText(q.get('slug'), 90);
      if (!slug) return j(res, 400, { error: 'slug query parameter is required' });
      await supa(`blog_posts?slug=eq.${encodeURIComponent(slug)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
      return j(res, 200, { ok: true });
    }

    return j(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    const detail = String(err && err.message ? err.message : err);
    if (isSetupError(detail)) {
      return j(res, 503, { error: 'Blog table missing. Run supabase-v26-blog-interview.sql in Supabase.' });
    }
    return j(res, 500, { error: 'Blog request failed', details: detail.slice(0, 300) });
  }
};
