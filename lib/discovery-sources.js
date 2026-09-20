/**
 * CivilCareer — optional configured discovery providers
 *
 * This module is deliberately dependency-free. Configured providers are
 * optional; the core /api/jobs endpoint must continue working when none are
 * configured or when a provider is unavailable. Public no-key discovery
 * sources are handled separately by api/jobs.js.
 */

function stat(name, extra = {}) {
  return {
    name,
    configured: false,
    ok: true,
    items: 0,
    error: null,
    remaining: null,
    reset: null,
    ...extra,
  };
}

async function runConfiguredSources() {
  // Keep this function intentionally non-throwing. Provider-specific
  // integrations can be added here later without coupling them to the main
  // jobs API boot process.
  return {
    jobs: [],
    stats: {
      serpapi: stat('Google Jobs via SerpApi'),
      adzuna: stat('Adzuna'),
      muse: stat('The Muse'),
      jobvetta: stat('Jobvetta'),
    },
  };
}

module.exports = { runConfiguredSources };
