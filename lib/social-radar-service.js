/**
 * CivilCareer — Social Engine Phase 2 radar service.
 * Uses the same server-side PostgREST convention as the Social API.
 * No credentials are returned to callers.
 */
const core = require('./social-core');
const templates = require('./social-templates');
const radar = require('./social-radar');
const radarEvents = require('./radar-events');
const content = require('./social-radar-content');

const SOURCE_TABLES = { job: 'jobs', govt_job: 'govt_jobs' };

function config() {
  return {
    url: String(process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    key: String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''),
  };
}

async function supa(path, opts = {}) {
  const { url, key } = config();
  return fetch(url + '/rest/v1/' + path, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
}

function sourceTable(type) {
  return SOURCE_TABLES[type] || '';
}

async function fetchSource(type, id) {
  const table = sourceTable(type);
  if (!table) return null;
  const r = await supa(table + '?select=*&id=eq.' + encodeURIComponent(id) + '&limit=1');
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) ? rows[0] || null : null;
}

function verified(type, row) {
  if (!row) return { ok: false, error: 'Source record not found' };
  if (type === 'job') {
    if (row.published !== true) return { ok: false, error: 'Private job is not published' };
    const review = String(row.review_state || '').toLowerCase();
    const verification = String(row.verification_status || '').toLowerCase();
    if (review && review !== 'published') return { ok: false, error: 'Private job has not been admin-reviewed' };
    if (verification && verification !== 'verified') return { ok: false, error: 'Private job has not been verified' };
    return { ok: true };
  }
  if (type === 'govt_job') {
    if (String(row.status || '').toLowerCase() !== 'active') return { ok: false, error: 'Government job is not active' };
    if (!row.reviewed_at) return { ok: false, error: 'Government job has not been reviewed' };
    const civil = Number(row.civil_posts_count);
    if (!Number.isFinite(civil) || civil <= 0) return { ok: false, error: 'Government job has no verified Civil posts' };
    return { ok: true };
  }
  return { ok: false, error: 'Unsupported radar source' };
}

function siteUrlFromSettings(settings) {
  return String((settings && settings.site_url) || process.env.SITE_URL || '').replace(/\/+$/, '');
}

async function activeSuggestionExists(sourceType, sourceId, templateKey) {
  const path = 'social_suggestions?select=id,status,template_key'
    + '&source_type=eq.' + encodeURIComponent(sourceType)
    + '&source_id=eq.' + encodeURIComponent(sourceId)
    + '&template_key=eq.' + encodeURIComponent(templateKey)
    + '&status=not.in.(rejected,archived)&limit=1';
  const r = await supa(path);
  if (!r.ok) return { ok: false, error: 'Could not check existing suggestion' };
  const rows = await r.json();
  return { ok: true, exists: Array.isArray(rows) && Boolean(rows[0]) };
}

async function insertSuggestion(suggestion) {
  const r = await supa('social_suggestions', {
    method: 'POST',
    body: JSON.stringify(suggestion),
  });
  if (r.ok) {
    const rows = await r.json();
    return { created: true, suggestion: Array.isArray(rows) ? rows[0] : rows };
  }
  const detail = await r.text();
  if (/23505|duplicate key value/i.test(detail)) return { created: false, existed: true };
  return { created: false, error: 'Suggestion could not be created' };
}

function buildSuggestionPayload(sourceType, sourceId, row, event, settings, createdBy) {
  const snapshot = templates.buildSnapshot(sourceType, row);
  const rendered = content.renderRadarContent(sourceType, event, row, siteUrlFromSettings(settings));
  return {
    source_type: sourceType,
    source_id: sourceId,
    template_key: sourceType + '.radar.' + event,
    ...rendered,
    source_snapshot: snapshot,
    truth_hash: core.truthHash(snapshot),
    truth_state: 'locked',
    truth_checked_at: new Date().toISOString(),
    status: 'pending',
    created_by: createdBy || 'social-radar',
  };
}

async function generateRadarSuggestions(options = {}) {
  const settings = options.settings || {};
  const sourceTypes = options.sourceType ? [options.sourceType] : ['job', 'govt_job'];
  const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 200);
  const now = options.now == null ? Date.now() : Number(options.now);
  const results = [];
  let scanned = 0;

  for (const type of sourceTypes) {
    if (!SOURCE_TABLES[type]) continue;
    const query = type === 'job'
      ? 'published=eq.true&limit=' + limit
      : 'status=eq.active&limit=' + limit;
    const r = await supa(SOURCE_TABLES[type] + '?select=*&' + query);
    if (!r.ok) {
      results.push({ source_type: type, error: 'Source records could not be loaded' });
      continue;
    }
    const rows = await r.json();
    for (const row of Array.isArray(rows) ? rows : []) {
      scanned += 1;
      const check = verified(type, row);
      if (!check.ok) continue;

      const events = radarEvents.events(type, row, now, settings.caps_timezone || 'Asia/Kolkata');
      for (const event of events) {
        const templateKey = type + '.radar.' + event;
        const existing = await activeSuggestionExists(type, row.id, templateKey);
        if (!existing.ok || existing.exists) continue;

        const suggestion = buildSuggestionPayload(type, row.id, row, event, settings, options.createdBy);
        const contentCheck = core.validateContent(suggestion);
        if (!contentCheck.ok) {
          results.push({ source_type: type, id: row.id, event, error: contentCheck.errors.join('; ') });
          continue;
        }
        const facts = core.validateFacts(suggestion, suggestion.source_snapshot, siteUrlFromSettings(settings));
        if (!facts.ok) {
          results.push({ source_type: type, id: row.id, event, error: 'FACT CHECK FAILED: ' + facts.errors.join('; ') });
          continue;
        }
        const created = await insertSuggestion(suggestion);
        results.push({
          source_type: type,
          id: row.id,
          event,
          created: Boolean(created.created),
          existed: Boolean(created.existed),
          error: created.error || null,
        });
      }
    }
  }

  return {
    scanned,
    created: results.filter((x) => x.created).length,
    skipped: results.filter((x) => x.existed).length,
    results,
  };
}

async function latestPublishedBaseline(sourceType, sourceId) {
  const templateKey = sourceType + '.published.default';
  const r = await supa(
    'social_suggestions?select=id,source_snapshot,status,created_at'
    + '&source_type=eq.' + encodeURIComponent(sourceType)
    + '&source_id=eq.' + encodeURIComponent(sourceId)
    + '&template_key=eq.' + encodeURIComponent(templateKey)
    + '&order=created_at.desc&limit=1'
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function detectUpdate(sourceType, sourceId) {
  if (!['job', 'govt_job'].includes(sourceType)) return { ok: false, status: 400, error: 'Updates support job and govt_job only' };
  const row = await fetchSource(sourceType, sourceId);
  const check = verified(sourceType, row);
  if (!check.ok) return { ok: false, status: 409, error: check.error };

  const baseline = await latestPublishedBaseline(sourceType, sourceId);
  if (!baseline || !baseline.source_snapshot) {
    return { ok: false, status: 404, error: 'No published Social Engine baseline exists for this source yet' };
  }

  const changes = radar.compareUpdates(sourceType, baseline.source_snapshot, row);
  if (!changes.length) {
    return { ok: true, changed: false, source_id: sourceId, changes: [] };
  }

  const templateKey = radar.updateTemplateKey(sourceType, changes);
  return {
    ok: true,
    changed: true,
    source_id: sourceId,
    sourceType,
    row,
    baseline,
    changes,
    templateKey,
  };
}

async function generateUpdateSuggestion(sourceType, sourceId, settings, createdBy) {
  const detected = await detectUpdate(sourceType, sourceId);
  if (!detected.ok || !detected.changed) return detected;

  const exists = await activeSuggestionExists(sourceType, sourceId, detected.templateKey);
  if (!exists.ok) return { ok: false, status: 500, error: exists.error };
  if (exists.exists) return { ok: true, changed: true, created: false, existed: true, changes: detected.changes };

  const snapshot = templates.buildSnapshot(sourceType, detected.row);
  const rendered = content.renderUpdateContent(sourceType, detected.row, detected.changes, siteUrlFromSettings(settings));
  const suggestion = {
    source_type: sourceType,
    source_id: sourceId,
    template_key: detected.templateKey,
    ...rendered,
    source_snapshot: snapshot,
    truth_hash: core.truthHash(snapshot),
    truth_state: 'locked',
    truth_checked_at: new Date().toISOString(),
    status: 'pending',
    created_by: createdBy || 'social-update',
  };

  const check = core.validateContent(suggestion);
  if (!check.ok) return { ok: false, status: 400, error: check.errors.join('; ') };
  const facts = core.validateFacts(suggestion, snapshot, siteUrlFromSettings(settings));
  if (!facts.ok) return { ok: false, status: 400, error: 'FACT CHECK FAILED: ' + facts.errors.join('; ') };

  const created = await insertSuggestion(suggestion);
  if (created.error) return { ok: false, status: 500, error: created.error };
  return {
    ok: true,
    changed: true,
    created: Boolean(created.created),
    existed: Boolean(created.existed),
    changes: detected.changes,
    suggestion: created.suggestion || null,
  };
}

module.exports = {
  SOURCE_TABLES,
  fetchSource,
  verified,
  generateRadarSuggestions,
  detectUpdate,
  generateUpdateSuggestion,
};
