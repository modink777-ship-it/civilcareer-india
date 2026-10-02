'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');

test('missing optional forms do not abort the public app bootstrap', () => {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(source, /function wireForm\(id,url,transform=x=>x\)\{const f=\$\(id\);if\(!f\)return;/);
});

test('homepage background photos are disabled while other route visuals remain', () => {
  const source = fs.readFileSync(path.join(root, 'visual-backgrounds.js'), 'utf8');
  assert.match(source, /if\(route==='home'\)\s*\{/);
  assert.match(source, /timer=null;\s*return;/);
  assert.match(source, /const hero=active\.querySelector\('\.hero, \.careerhub-hero'\)/);
});

test('small-screen homepage shows its content without the promo panel or tools row', () => {
  const source = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.match(source, /@media \(max-width: 760px\)\s*\{[\s\S]*?\.tools-row\s*\{\s*display:\s*none/);
  assert.match(source, /\.page\[data-page="home"\]\s+\.hero-panel\s*\{\s*display:\s*none/);
  assert.match(source, /\.hero-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test('hero SVG remains decorative and key home labels have dark-theme contrast rules', () => {
  const source = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.match(source, /\.hero > \.cc-aceternity-paths[\s\S]*?position:\s*absolute/);
  assert.match(source, /html\[data-theme="dark"\] \.stat-label\s*\{\s*color:\s*#b8c6d6/);
  assert.match(source, /html\[data-theme="dark"\] \.tools-row-inner a[\s\S]*?color:\s*var\(--ink\)/);
  assert.match(source, /html\[data-theme="dark"\] \.lang-option\.active[\s\S]*?color:\s*#fff/);
});

test('company review page uses explicit working routes and checks list response status', () => {
  const source = fs.readFileSync(path.join(root, 'companies.html'), 'utf8');
  assert.ok(source.includes("fetch('/api/companies-review').then(function(r){if(!r.ok)"));
  assert.ok(source.includes("fetch('/api/companies-review?slug="));
  assert.ok(source.includes("fetch('/api/companies/review'"));
});

test('paginated job requests use the list response even when the router supplies a path slug', async () => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  const handleJobs = require('../_api/jobs');
  const originalFetch = global.fetch;
  let requestedUrl = '';

  global.fetch = async url => {
    requestedUrl = String(url);
    return {
      ok: true,
      json: async () => [{ id: 'job-1', role: 'Site Engineer', expires_at: null }],
      headers: { get: name => name.toLowerCase() === 'content-range' ? '0-0/1' : null },
    };
  };

  try {
    const res = {
      statusCode: 0,
      headers: {},
      headersSent: false,
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
      end(body) { this.body = body ? JSON.parse(String(body)) : this.body; this.headersSent = true; return this; },
    };
    await handleJobs({
      method: 'GET',
      url: '/api/jobs?page=1&limit=5',
      query: { slug: 'jobs', page: '1', limit: '5' },
      headers: {},
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(requestedUrl.includes('slug=eq.jobs'), false);
    assert.deepEqual(res.body.jobs.map(job => job.id), ['job-1']);
  } finally {
    global.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
});

test('interview moderation gives an actionable 503 when the v26 table is missing', async () => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const oldOwner = process.env.OWNER_KEY;
  const originalFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.OWNER_KEY = 'test-owner-key';
  global.fetch = async () => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
    headers: new Headers(),
    text: async () => JSON.stringify({
      code: 'PGRST205',
      message: "Could not find the table 'public.interview_questions' in the schema cache",
    }),
  });

  try {
    const handleInterview = require('../_api/interview');
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      end(body) { this.body = body ? JSON.parse(String(body)) : this.body; },
    };
    await handleInterview({
      method: 'GET',
      url: '/api/interview?status=pending',
      headers: { 'x-owner-key': 'test-owner-key' },
    }, res);

    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /supabase-v26-blog-interview\.sql/);
  } finally {
    global.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
    if (oldOwner === undefined) delete process.env.OWNER_KEY;
    else process.env.OWNER_KEY = oldOwner;
  }
});

test('interview questions load through PostgREST and retain the public response shape', async () => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  let requestedUrl = '';
  global.fetch = async url => {
    requestedUrl = String(url);
    return {
      ok: true,
      headers: new Headers({ 'content-range': '0-0/1' }),
      text: async () => JSON.stringify([{
        id: 'question-1',
        company: 'CivilCo',
        role: 'Site Engineer',
        question: 'How do you check concrete quality?',
        is_approved: true,
      }]),
    };
  };

  try {
    const handleInterview = require('../_api/interview');
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      end(body) { this.body = body ? JSON.parse(String(body)) : this.body; },
    };
    await handleInterview({
      method: 'GET',
      url: '/api/interview?page=1',
      headers: {},
    }, res);

    assert.equal(res.statusCode, 200);
    assert.match(requestedUrl, /\/rest\/v1\/interview_questions\?/);
    assert.equal(res.body.questions[0].id, 'question-1');
    assert.equal(res.body.total, 1);
  } finally {
    global.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
});

test('public blog listing uses the v26 schema and maps fields used by blog pages', async () => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  let requestedUrl = '';
  global.fetch = async url => {
    requestedUrl = String(url);
    return {
      ok: true,
      headers: new Headers({ 'content-range': '0-0/1' }),
      text: async () => JSON.stringify([{
        id: 'post-1',
        slug: 'site-engineer-guide',
        title: 'Site Engineer Guide',
        excerpt: 'A practical guide',
        created_at: '2026-10-01T00:00:00.000Z',
        is_published: true,
      }]),
    };
  };

  try {
    const handleBlog = require('../_api/blog');
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      end(body) { this.body = body ? JSON.parse(String(body)) : this.body; },
    };
    await handleBlog({
      method: 'GET',
      url: '/api/blog?page=1',
      headers: {},
    }, res);

    assert.equal(res.statusCode, 200);
    assert.match(requestedUrl, /\/rest\/v1\/blog_posts\?/);
    assert.match(requestedUrl, /is_published=eq\.true/);
    assert.equal(res.body.posts[0].meta_description, 'A practical guide');
    assert.equal(res.body.posts[0].published_at, '2026-10-01T00:00:00.000Z');
    assert.equal(res.body.total, 1);
  } finally {
    global.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
});

test('public blog detail reads v26 columns and increments views without changing its response shape', async () => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET', body: options.body });
    return {
      ok: true,
      headers: new Headers(),
      text: async () => JSON.stringify([{
        id: 'post-1',
        slug: 'site-engineer-guide',
        title: 'Site Engineer Guide',
        excerpt: 'A practical guide',
        content: 'Article content',
        views: 4,
        created_at: '2026-10-01T00:00:00.000Z',
        is_published: true,
      }]),
    };
  };

  try {
    const handleBlog = require('../_api/blog');
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      end(body) { this.body = body ? JSON.parse(String(body)) : this.body; },
    };
    await handleBlog({
      method: 'GET',
      url: '/api/blog?slug=site-engineer-guide',
      headers: {},
    }, res);

    assert.equal(res.statusCode, 200);
    assert.match(requests[0].url, /\/rest\/v1\/blog_posts\?/);
    assert.equal(res.body.post.meta_description, 'A practical guide');
    assert.equal(res.body.post.published_at, '2026-10-01T00:00:00.000Z');
    assert.equal(requests[1].method, 'PATCH');
    assert.equal(JSON.parse(requests[1].body).views, 5);
  } finally {
    global.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
});

test('interview pending queue is admin-only and missing table response points to v26 setup', () => {
  const source = fs.readFileSync(path.join(root, '_api', 'interview.js'), 'utf8');
  assert.match(source, /pendingOnly && !isAdmin\(req, \{\}\)/);
  assert.match(source, /is_approved: `eq\.\$\{!pendingOnly\}`/);
  assert.match(source, /\/rest\/v1\/interview_questions/);
  assert.match(source, /supabase-v26-blog-interview\.sql/);
});

test('feature SQL keeps profile, review, blog and interview tables service-role-only', () => {
  for (const filename of ['supabase-v25-portfolio-reviews.sql', 'supabase-v26-blog-interview.sql']) {
    const source = fs.readFileSync(path.join(root, filename), 'utf8');
    assert.match(source, /ENABLE ROW LEVEL SECURITY/);
    assert.match(source, /REVOKE ALL PRIVILEGES ON TABLE public\.%I FROM PUBLIC, anon, authenticated/);
    assert.match(source, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.%I TO service_role/);
    assert.match(source, /FOR ALL TO service_role USING \(true\) WITH CHECK \(true\)/);
  }
  const reviewsSql = fs.readFileSync(path.join(root, 'supabase-v25-portfolio-reviews.sql'), 'utf8');
  assert.match(reviewsSql, /"current_role"\s+text/);
});
