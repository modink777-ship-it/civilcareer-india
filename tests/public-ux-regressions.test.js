'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('homepage search form closes before sections and home section is not nested twice', () => {
  const html = read('index.html');
  const start = html.indexOf('<div class="container search-wrap">');
  const end = html.indexOf('<section class="section soft" id="homeLatest">');
  assert.ok(start >= 0 && end > start);
  const search = html.slice(start, end);
  assert.match(search, /<form class="smart-search"[\s\S]*<\/form><\/div>\s*$/);
  assert.equal((html.match(/id="homeLatest"/g) || []).length, 1);
});

test('About and Post a Job SPA pages have content and Browse Talent links to the job form', () => {
  const html = read('index.html');
  const talent = read('talent.html');
  assert.match(html, /data-page="about"[\s\S]*?About CivilCareer[\s\S]*?Our priorities/);
  assert.match(html, /data-page="post"[\s\S]*?id="employerForm"/);
  assert.match(talent, /href="\/post-a-job"[^>]*>Post a Job<\/a>/);
});

test('header search opens and submits the compound search overlay accessibly', () => {
  const app = read('app.js');
  assert.match(app, /\$\('searchOpen'\)\?\.addEventListener\('click',openCcSearch\)/);
  assert.match(app, /\$\('ccSearchGo'\)\?\.addEventListener\('click'/);
  assert.match(app, /aria-modal','true'/);
  assert.match(app, /e\.key==='Escape'/);
});

test('language selection persists and includes Hindi, Kannada, Telugu and Tamil UI translations', () => {
  const source = read('translations.js');
  assert.match(source, /hi:\s*\{/);
  assert.match(source, /kn:\s*\{/);
  assert.match(source, /te:\s*\{/);
  assert.match(source, /ta:\s*\{/);
  assert.match(source, /civilcareer:languagechange/);
  assert.doesNotMatch(source, /removeItem\(["']cc_lang["']\)/);
});

test('dark mode provides contrast for stats, profile chips and job-card actions', () => {
  const css = read('styles.css');
  assert.match(css, /html\[data-theme="dark"\] \.stats-strip \.stat-num\s*\{\s*color:\s*#f1c66d/);
  assert.match(css, /html\[data-theme="dark"\] \.foryou-home-facets span\s*\{[^}]*color:\s*#edf4fb/);
  assert.match(css, /html\[data-theme="dark"\] \.cc-compact-actions \.cc-view-btn/);
  assert.match(css, /html\[data-theme="dark"\] \.cc-compact-actions \.cc-apply-btn/);
});

test('search and footer layouts collapse without clipping on narrow screens', () => {
  const css = read('styles.css');
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.smart-search\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.cc-search-fields-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.footer-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
});

test('3D hero canvas is layered decoratively and receives a dark-theme visibility boost', () => {
  const css = read('styles.css');
  const hero3d = read('hero-3d.js');
  assert.match(css, /\.hero > \.hero-3d-canvas\s*\{[^}]*position:\s*absolute/);
  assert.match(css, /html\[data-theme="dark"\] \.hero-3d-canvas\s*\{[^}]*mix-blend-mode:\s*screen/);
  assert.doesNotMatch(css, /@media\s*\(max-width:\s*479px\)\s*\{[^}]*\.hero-3d-canvas\s*\{[^}]*display:\s*none/);
  assert.match(hero3d, /var SMALL = window\.innerWidth < 480/);
  assert.match(hero3d, /buildings = buildings\.slice\(-36\)/);
});
