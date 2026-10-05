'use strict';

/**
 * CivilCareer — structured extraction for LEAD-ONLY aggregator feeds.
 *
 * Why this file exists
 * --------------------
 * The five engineering aggregators the site tracks do not publish a feed. They
 * publish a *table per discipline* or a *card per posting*, and their anchors say
 * "Apply Now" / "View / Apply" / "Detail" — never the branch. The generic crawler
 * used to harvest every <a>, hand the whole page text to the classifier and throw
 * away the one field that proves a job is civil: the Qualification column. The
 * crawl reported success while staging nothing.
 *
 * Each adapter below reads the site's own structure and returns one record per
 * posting, carrying the qualification / post name / section the site itself used.
 * Extraction is pure (no network, no DB) so it is unit-tested against saved copies
 * of the real pages (tests/fixtures/govt-aggregators).
 *
 * How a record is judged civil — two scopes
 * -----------------------------------------
 *   explicit : the row's own words name civil engineering (govtjobguru's mixed
 *              engineering table, freejobalert's per-state tables). Nothing else
 *              qualifies.
 *   section  : the site itself filed the posting under a civil heading — the
 *              "Civil (23)" table on linkingsky, or the /civil-engineering-jobs
 *              category on allgovernmentjobs and karnatakacareers. The site's own
 *              classification is the evidence: those pages exist to list jobs a
 *              civil engineering degree qualifies you for.
 *
 * One override applies in both scopes: when the row enumerates branches and civil
 * is not among them (BEL "CSE/ ECE/ Mechanical Engineering"), the row is dropped
 * even inside a civil section — the site's tagging is looser than its own text.
 *
 * The ruling question is always "does a civil engineering degree qualify you for
 * this post?" — a related-but-not-civil post is kept and marked `related`, never
 * claimed as a civil post. Records are LEADS: `_api/govt-review.js` still demands
 * a real official-host notice URL before any of this can be published.
 */

const { classifyNotificationDetailed } = require('./civil-classifier');

/* ── tiny HTML helpers (kept local so this module has no runtime deps) ───── */

function clean(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#8211;/gi, '-').replace(/&#8212;/gi, '-').replace(/&#8217;/gi, "'")
    .replace(/\s+/g, ' ').trim();
}
function absolute(href, base) {
  try { return new URL(String(href || '').trim(), base).href; } catch { return ''; }
}
function tablesOf(html) { return String(html || '').match(/<table\b[\s\S]*?<\/table>/gi) || []; }

/* One row, with its cells AND the first href inside each cell. The href matters:
   govtjobguru puts the real job page in the "Detail" column and linkingsky puts
   the official/PDF target on the organization name. */
function rowsOf(tableHtml) {
  return (String(tableHtml || '').match(/<tr\b[\s\S]*?<\/tr>/gi) || []).map(tr => {
    const tds = tr.match(/<t[hd]\b[^>]*>[\s\S]*?<\/t[hd]>/gi) || [];
    return {
      html: tr,
      cells: tds.map(clean),
      hrefs: tds.map(td => (td.match(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/i) || [])[1] || ''),
    };
  });
}
function firstHref(fragment) {
  return (String(fragment || '').match(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
}
function headingsWithTables(html) {
  const heads = [];
  const hre = /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = hre.exec(html))) heads.push({ pos: m.index, text: clean(m[2]) });
  const tables = [];
  const tre = /<table\b[\s\S]*?<\/table>/gi;
  while ((m = tre.exec(html))) tables.push({ pos: m.index, html: m[0] });
  return { heads, tables };
}

/* ── civil ruling ──────────────────────────────────────────────────────── */

const BRANCH = /\b(mechanical|electrical|electronics|electronic|instrumentation|metallurgical|metallurgy|chemical|marine|computer science|cse|ece|eee|agricultural|biotechnology|automobile|automotive|mining|textile|aeronautical|aerospace|ceramic|civil)\b/i;
/* Post names that carry civil posts on a mixed engineering listing, where the row's
   own qualification cell only says "Diploma, BE/B.Tech, Diploma" (SSC JE) and the
   branch lives in the official notification. Deliberately excludes bare "project
   engineer": that phrase is dominated by software and research posts (C-DAC, BEE,
   IIT project staff) and would flood the civil queue with them. */
const CIVIL_ROLE = /\b((?:junior|sub|assistant|executive|additional|deputy|chief)\s+engineer|engineer\s*\(\s*civil|civil\s+engineer|drafts?man|draughts?man|surveyor|overseer|foreman|engineering\s+services|technical\s+graduate\s+course)\b/i;

/** True when the text enumerates engineering branches and civil is not one of them. */
function branchListExcludesCivil(text) {
  const t = clean(text);
  if (/\bcivil\b/i.test(t)) return false;
  return BRANCH.test(t);
}

/** Build the classifier input for one record and rule on it. */
function selectCivil(record) {
  const text = [record.org, record.postName, record.qualification, record.excerpt].filter(Boolean).join(' ');
  if (branchListExcludesCivil(`${record.postName} ${record.qualification} ${record.excerpt || ''}`)) {
    return { keep: false, reason: 'branches_exclude_civil', evidence: record.evidence };
  }
  const explicitlyCivil = /\bcivil\b/i.test(text);
  if (explicitlyCivil) return { keep: true, evidence: 'qualification', eligible: false };
  if (record.scope === 'explicit' && !record.allowRole) {
    return { keep: false, reason: 'no_civil_evidence', evidence: 'none' };
  }
  if (CIVIL_ROLE.test(record.postName || '')) return { keep: true, evidence: 'role', eligible: true };
  if (record.scope === 'explicit') return { keep: false, reason: 'no_civil_evidence', evidence: 'none' };
  /* section scope: the source filed it under civil. Keep it as eligibility
     ("a civil engineering degree qualifies") rather than as a civil post. */
  return { keep: true, evidence: 'section', eligible: true };
}

/** Classifier verdict for a kept record (same library the staging writer uses). */
function classifyRecord(record, select) {
  const post = {
    post_name: record.postName || record.title,
    discipline: record.discipline || record.section || null,
    qualification: record.qualification || null,
    civil_eligible: Boolean(select && select.eligible) || undefined,
  };
  const context = {
    title: record.title,
    description: [record.org, record.postName, record.qualification, record.excerpt].filter(Boolean).join(' '),
    organization: record.org || record.section || 'Government organization',
    org_hint: record.org || record.section || null,
  };
  return classifyNotificationDetailed([post], context);
}

/* ── adapters ────────────────────────────────────────────────────────────── */

/* govtjobguru /jobs-by-post/engineering-jobs/ publishes ONE table:
   Organization | Posts | Post Name | Qualification | Deadline(DD-MM-YY) | Details.
   It covers every branch, so a row must name civil itself. The Qualification cell
   spells it out ("Diploma/Degree in Civil Engineering"), and the Details cell holds
   the job page — no detail fetch is needed to classify. */
const govtjobguru = {
  id: 'govtjobguru-table',
  label: 'govtjobguru engineering table (Qualification column)',
  match: (host) => /(^|\.)govtjobguru\.in$/.test(host),
  scope: 'explicit',
  extract(html, base) {
    const out = [];
    for (const table of tablesOf(html)) {
      const rows = rowsOf(table);
      if (rows.length < 2) continue;
      const header = rows[0].cells.map(c => c.toLowerCase());
      const at = (name) => header.findIndex(h => h.includes(name));
      const iOrg = at('organization'), iPost = at('post name'), iQual = at('qualification');
      const iCount = at('posts'), iDeadline = at('deadline'), iDetail = at('details');
      if (iPost === -1 || iQual === -1) continue;
      for (const r of rows.slice(1)) {
        const org = r.cells[iOrg] || '';
        const postName = r.cells[iPost] || '';
        if (!postName) continue;
        const url = absolute(r.hrefs[iDetail > -1 ? iDetail : iOrg] || r.hrefs.find(Boolean), base);
        if (!url) continue;
        out.push({
          title: [org, postName].filter(Boolean).join(' - '),
          url, org, postName,
          qualification: r.cells[iQual] || '',
          vacancies: r.cells[iCount] || '',
          deadlineText: r.cells[iDeadline] || '',
          section: 'Engineering Jobs',
          scope: 'explicit',
        });
      }
    }
    return out;
  },
};

/* karnatakacareers files its civil-engineering qualification category as one
   `article.job-card` per posting, each with a Qualification row in a mini table —
   and often the branch list itself ("BE/ B.Tech in Civil/ Mechanical Engineering").
   The listing paginates to 78 pages, but new postings land on page 1, so page 1
   plus one extra page covers a burst; older pages are backfill we do not need. */
const karnatakacareers = {
  id: 'karnatakacareers-cards',
  label: 'karnatakacareers qualification cards',
  match: (host) => /(^|\.)karnatakacareers\.org$/.test(host),
  scope: 'section',
  category: 'civil engineering jobs',
  extract(html, base) {
    const out = [];
    const cards = String(html || '').match(/<article\b[^>]*class="[^"]*job-card[^"]*"[\s\S]*?<\/article>/gi) || [];
    for (const card of cards) {
      const title = clean((card.match(/<h2\b[^>]*class="[^"]*job-card__title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i) || [])[1]);
      const fields = {};
      for (const r of rowsOf(card)) {
        if (r.cells.length >= 2) fields[r.cells[0].toLowerCase()] = r.cells[1];
      }
      const btn = (card.match(/<a\b[^>]*class="[^"]*job-card__btn[^"]*"[^>]*>/i) || [])[0];
      const url = absolute(firstHref(btn) || firstHref(card), base);
      if (!url || !title) continue;
      out.push({
        title, url,
        org: fields.organization || '',
        postName: fields['post name'] || '',
        qualification: fields.qualification || '',
        vacancies: fields['no of vacancies'] || '',
        deadlineText: clean((card.match(/class="[^"]*job-card__date[^"]*"[^>]*>([\s\S]*?)</i) || [])[1]),
        section: this.category,
        discipline: this.category,
        scope: 'section',
      });
    }
    return out;
  },
  /* Next page only, and only when the page links one, so one aggregator cannot eat
     the workflow's whole timeout budget. */
  nextPage(html, base) {
    const m = String(html || '').match(/<a\b[^>]*href="([^"]*\/page\/\d+\/?)"[^>]*>\s*(?:Next|&raquo;)/i);
    return m ? absolute(m[1], base) : '';
  },
};

/* linkingsky sections its single page BY DISCIPLINE: an <h2>Civil (23)</h2> followed
   by a table of Posted on | Organization | Posts | Type | Last Date. The Posts text
   ("195 Apprentices", "4 Individual Consultant") never names a branch — the section
   heading is the only discipline evidence on the page. */
const linkingsky = {
  id: 'linkingsky-section-table',
  label: 'linkingsky per-discipline section table',
  match: (host) => /(^|\.)linkingsky\.com$/.test(host),
  scope: 'section',
  sectionPattern: /^civil\b/i,
  extract(html, base) {
    const out = [];
    const { heads, tables } = headingsWithTables(html);
    for (const t of tables) {
      const head = [...heads].reverse().find(h => h.pos < t.pos);
      if (!head || !this.sectionPattern.test(head.text)) continue;
      for (const r of rowsOf(t.html).slice(1)) {
        if (r.cells.length < 3) continue;
        const org = r.cells[1] || '';
        const posts = r.cells[2] || '';
        if (!posts) continue;
        const url = absolute(r.hrefs[1] || r.hrefs.find(Boolean) || '', base) || `${base}#engineer-civil`;
        out.push({
          title: [org, posts].filter(Boolean).join(' - '),
          url, org, postName: posts,
          qualification: '',
          vacancies: '',
          deadlineText: r.cells[4] || '',
          postedOn: r.cells[0] || '',
          section: clean(head.text),
          discipline: 'Civil',
          scope: 'section',
        });
      }
    }
    return out;
  },
};

/* allgovernmentjobs.in/civil-engineering-jobs is the site's OWN civil category,
   rendered as a card per posting: card-title, date, excerpt, "View / Apply". */
const allgovernmentjobs = {
  id: 'allgovernmentjobs-cards',
  label: 'allgovernmentjobs civil category cards',
  match: (host) => /(^|\.)allgovernmentjobs\.in$/.test(host),
  scope: 'section',
  category: 'civil engineering jobs',
  extract(html, base) {
    const out = [];
    const chunks = String(html || '').split(/<div class="card shadow-none border">/i).slice(1);
    for (const chunk of chunks) {
      const title = clean((chunk.match(/class="card-title[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || [])[1]);
      const excerpt = clean((chunk.match(/class="content"[^>]*>([\s\S]*?)<\/div>/i) || [])[1]);
      const postedOn = clean((chunk.match(/(\d{2}-[A-Za-z]{3}-\d{4})/) || [])[1]);
      const rel = (chunk.match(/<a\b[^>]*href="([^"]+)"[^>]*>\s*View\s*\/\s*Apply/i) || [])[1];
      const url = absolute(rel, base);
      if (!url || !title) continue;
      out.push({
        title, url,
        org: '',
        postName: title,
        qualification: '',
        vacancies: '',
        deadlineText: '',
        postedOn,
        excerpt,
        section: this.category,
        discipline: 'Civil',
        scope: 'section',
      });
    }
    return out;
  },
};

/* freejobalert's engineering page is a table PER STATE, all sharing the header
   Post Date | Recruitment Board | Exam / Post Name | Qualification | Advt No |
   Last Date | More Information. It is an all-branch listing, so a row qualifies
   only when its own words name civil, or when its post name is one of the roles
   whose notification carries civil posts (JE/AE/Sub Engineer/Draftsman/…). The
   same row repeats under several states, so dedupe by URL. */
const freejobalert = {
  id: 'freejobalert-qualification-tables',
  label: 'freejobalert qualification tables (state sections)',
  match: (host) => /(^|\.)freejobalert\.com$/.test(host),
  scope: 'explicit',
  /* All-branch listings still carry the roles whose notifications include civil
     posts. Their rows never name a branch, so a role match is kept as RELATED
     ('a civil engineering degree qualifies') instead of being thrown away. */
  allowRole: true,
  extract(html, base) {
    const out = [];
    for (const table of tablesOf(html)) {
      const rows = rowsOf(table);
      if (!rows.length) continue;
      const header = rows[0].cells.map(c => c.toLowerCase());
      const iBoard = header.findIndex(h => h.includes('recruitment board'));
      const iQual = header.findIndex(h => h.includes('qualification'));
      const iPost = header.findIndex(h => h.includes('post name'));
      const iDate = header.findIndex(h => h.includes('post date'));
      const iLast = header.findIndex(h => h.includes('last date'));
      const iAdvt = header.findIndex(h => h.includes('advt'));
      const iMore = header.findIndex(h => h.includes('more information'));
      if (iBoard === -1 || iQual === -1 || iPost === -1) continue;
      for (const r of rows.slice(1)) {
        const board = r.cells[iBoard] || '';
        const post = r.cells[iPost] || '';
        if (!post || /no jobs are currently available/i.test(post)) continue;
        const url = absolute(r.hrefs[iMore > -1 ? iMore : r.hrefs.findIndex(Boolean)], base);
        if (!url) continue;
        out.push({
          title: [board, post].filter(Boolean).join(' - '),
          url, org: board, postName: post,
          qualification: r.cells[iQual] || '',
          vacancies: '',
          advtNo: iAdvt > -1 ? r.cells[iAdvt] : '',
          deadlineText: iLast > -1 ? r.cells[iLast] : '',
          postedOn: iDate > -1 ? r.cells[iDate] : '',
          section: 'Engineering Jobs',
          scope: 'explicit',
          allowRole: true,
        });
      }
    }
    const seen = new Set();
    return out.filter(r => (seen.has(r.url) ? false : (seen.add(r.url), true)));
  },
};

/* ka.indgovtjobs.net/qualifications/engineering-government-jobs-karnataka/ is a
   Karnataka jobs board whose long guide prose sits above a `table.ka-table` of
   the latest postings (Job Title | Action). It is a MIXED list — court typists,
   forest watchers and agricultural officers sit beside engineering posts — and
   the title is the only discipline evidence, so this source contributes only
   when a posting names civil engineering or a civil-carrying engineering role. */
const kaIndgovtjobs = {
  id: 'ka-indgovtjobs-table',
  label: 'ka.indgovtjobs.net latest jobs table (Job Title | Action)',
  match: (host) => /(^|\.)indgovtjobs\.net$/.test(host),
  scope: 'explicit',
  allowRole: true,
  extract(html, base) {
    const out = [];
    for (const table of tablesOf(html)) {
      const rows = rowsOf(table);
      if (rows.length < 2) continue;
      const header = rows[0].cells.map(c => c.toLowerCase());
      const iTitle = header.findIndex(h => h.includes('job title'));
      const iAction = header.findIndex(h => h.includes('action'));
      if (iTitle === -1 || iAction === -1) continue;
      for (const r of rows.slice(1)) {
        const title = r.cells[iTitle] || '';
        if (!title) continue;
        const url = absolute(r.hrefs[iAction] || r.hrefs.find(Boolean), base);
        if (!url) continue;
        out.push({
          title, url,
          org: '',
          postName: title,
          qualification: '',
          vacancies: '',
          deadlineText: '',
          section: 'Latest Engineering Govt Jobs Karnataka',
          scope: 'explicit',
          allowRole: true,
        });
      }
    }
    return out;
  },
};

const ADAPTERS = [govtjobguru, karnatakacareers, linkingsky, allgovernmentjobs, freejobalert, kaIndgovtjobs];

/** Adapter for a source URL, or null when the crawler should fall back to the
 *  generic link harvester. */
function adapterFor(sourceUrl) {
  let host = '';
  try { host = new URL(sourceUrl).hostname.toLowerCase(); } catch { return null; }
  return ADAPTERS.find(a => a.match(host)) || null;
}

/** Official-host links on a page, best candidate first. Used to attach a real
 *  notification URL to a lead — the review gate refuses to publish an aggregator
 *  URL as the official notice. */
function officialNoticeLinks(html, base, isOfficial) {
  const out = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const url = absolute(m[1], base);
    if (!url || !isOfficial(url)) continue;
    const text = clean(m[2]);
    const score = (/notif|advert|advt|recruit|apply|detail|download|pdf/i.test(text) ? 2 : 0)
      + (/\.pdf(?:$|[?#])/i.test(url) ? 2 : 0)
      + (/notif|advert|advt|recruit|pdf/i.test(url) ? 1 : 0);
    out.push({ url, score });
  }
  const seen = new Set();
  return out
    .sort((a, b) => b.score - a.score)
    .filter(x => (seen.has(x.url) ? false : (seen.add(x.url), true)))
    .map(x => x.url);
}

module.exports = {
  ADAPTERS, adapterFor, selectCivil, classifyRecord, branchListExcludesCivil,
  officialNoticeLinks, clean, absolute, tablesOf, rowsOf, firstHref, headingsWithTables,
};
