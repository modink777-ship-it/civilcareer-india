/**
 * CivilCareer — Jobs API v3
 * - Public GET: published jobs only
 * - Admin GET: all jobs
 * - Admin POST/PATCH/DELETE
 * - Handles empty optional date fields safely
 * - Uses Supabase service-role key on the server
 */

const SUPA = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

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

function getKey(req) {
  return req.headers['x-owner-key'] || '';
}

function isAdmin(req) {
  return getKey(req) === process.env.OWNER_KEY;
}

function cleanDates(obj) {
  const dateFields = [
    'application_start',
    'deadline',
    'posted_at',
    'published_at',
    'expires_at',
    'last_verified',
    'last_verified_at',
    'updated_at',
    'created_at',
  ];

  for (const field of dateFields) {
    if (obj[field] === '') {
      obj[field] = null;
    }
  }

  return obj;
}

function cleanArrays(obj) {
  const arrayFields = [
    'skills',
    'qualifications',
    'employment_types',
    'experience_ranges',
    'application_emails',
    'locations',
  ];

  for (const field of arrayFields) {
    if (obj[field] === '') {
      obj[field] = [];
    }

    if (typeof obj[field] === 'string') {
      try {
        const parsed = JSON.parse(obj[field]);
        if (Array.isArray(parsed)) {
          obj[field] = parsed;
        }
      } catch (e) {
        // Leave normal text values unchanged.
      }
    }
  }

  return obj;
}

function makeSlug(role, company, id) {
  const base = `${role || 'job'}-${company || 'company'}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

  return `${base || 'job'}-${id || Date.now()}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,PATCH,DELETE,OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type,x-owner-key'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!SUPA || !KEY) {
    return res.status(500).json({
      error: 'Supabase server configuration is missing',
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // GET
  // ────────────────────────────────────────────────────────────────────

  if (req.method === 'GET') {
    const slug =
      typeof req.query?.slug === 'string'
        ? req.query.slug.trim()
        : '';

    const id =
      typeof req.query?.id === 'string'
        ? req.query.id.trim()
        : '';

    let query;

    if (slug) {
      query =
        `jobs?slug=eq.${encodeURIComponent(slug)}` +
        (isAdmin(req) ? '' : '&published=eq.true') +
        '&limit=1';
    } else if (id) {
      query =
        `jobs?id=eq.${encodeURIComponent(id)}` +
        (isAdmin(req) ? '' : '&published=eq.true') +
        '&limit=1';
    } else {
      query = isAdmin(req)
        ? 'jobs?order=created_at.desc'
        : 'jobs?published=eq.true&order=created_at.desc';
    }

    try {
      const r = await supa(query);

      if (!r.ok) {
        const detail = await r.text();

        return res.status(500).json({
          error: 'Failed to load jobs',
          details: detail,
        });
      }

      const jobs = await r.json();

      if (slug || id) {
        return res.status(200).json({
          job: jobs[0] || null,
        });
      }

      return res.status(200).json({ jobs });
    } catch (err) {
      return res.status(500).json({
        error: 'Failed to load jobs',
        details: err.message,
      });
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // ADMIN AUTH REQUIRED FOR WRITES
  // ────────────────────────────────────────────────────────────────────

  if (!isAdmin(req)) {
    return res.status(401).json({
      error: 'Invalid owner key',
    });
  }

  let body = req.body || {};

  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      return res.status(400).json({
        error: 'Invalid JSON body',
      });
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // POST — CREATE JOB
  // ────────────────────────────────────────────────────────────────────

  if (req.method === 'POST') {
    try {
      const { id, key, ...rest } = body;

      cleanDates(rest);
      cleanArrays(rest);

      if (typeof rest.published !== 'boolean') {
  rest.published = true;
}

if (!rest.status) {
  rest.status = rest.published ? 'Active' : 'Pending Review';
}

      if (!rest.created_at) {
        rest.created_at = new Date().toISOString();
      }

      // Generate slug if one was not supplied.
      if (!rest.slug) {
        rest.slug = makeSlug(
          rest.role,
          rest.company,
          Date.now()
        );
      }

      const r = await supa('jobs', {
        method: 'POST',
        body: JSON.stringify(rest),
      });

      if (!r.ok) {
        const detail = await r.text();

        return res.status(500).json({
          error: 'Job could not be saved',
          details: detail,
        });
      }

      const data = await r.json();

      return res.status(201).json({
        success: true,
        job: Array.isArray(data) ? data[0] : data,
      });
    } catch (err) {
      return res.status(500).json({
        error: 'Job could not be saved',
        details: err.message,
      });
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // PATCH — UPDATE JOB
  // ────────────────────────────────────────────────────────────────────

  if (req.method === 'PATCH') {
    try {
      const { id, key, ...rest } = body;

      if (!id) {
        return res.status(400).json({
          error: 'Missing id',
        });
      }

      cleanDates(rest);
      cleanArrays(rest);

      const r = await supa(
        `jobs?id=eq.${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(rest),
        }
      );

      if (!r.ok) {
        const detail = await r.text();

        return res.status(500).json({
          error: 'Job could not be updated',
          details: detail,
        });
      }

      const data = await r.json();

      return res.status(200).json({
        success: true,
        job: Array.isArray(data) ? data[0] : data,
      });
    } catch (err) {
      return res.status(500).json({
        error: 'Job could not be updated',
        details: err.message,
      });
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // DELETE — DELETE JOB
  // ────────────────────────────────────────────────────────────────────

  if (req.method === 'DELETE') {
    try {
      const { id } = body;

      if (!id) {
        return res.status(400).json({
          error: 'Missing id',
        });
      }

      const r = await supa(
        `jobs?id=eq.${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      );

      if (!r.ok) {
        const detail = await r.text();

        return res.status(500).json({
          error: 'Job could not be deleted',
          details: detail,
        });
      }

      return res.status(200).json({
        success: true,
      });
    } catch (err) {
      return res.status(500).json({
        error: 'Job could not be deleted',
        details: err.message,
      });
    }
  }

  return res.status(405).json({
    error: 'Method not allowed',
  });
};
