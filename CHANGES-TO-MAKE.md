# Exact Changes to Make on GitHub

## 1. api/[[...path]].js — Add these 3 lines to the handlers object

Find this line:
  '/api/admin-jobs':           () => require('../_api/admin-jobs'),

Add immediately after:
  '/api/mock-tests':           () => require('../_api/mock-tests'),
  '/api/blog':                 () => require('../_api/blog'),
  '/api/interview':            () => require('../_api/interview'),

---

## 2. vercel.json — Add these lines inside the "rewrites" array

Find the last rewrite entry and add after it:
  { "source": "/mock-tests", "destination": "/mock-tests.html" },
  { "source": "/mock-tests/:exam", "destination": "/mock-tests.html" },
  { "source": "/blog", "destination": "/blog.html" },
  { "source": "/blog/:slug", "destination": "/blog-post.html" },
  { "source": "/interview", "destination": "/interview.html" },
  { "source": "/interview/:slug", "destination": "/interview.html" }

---

## 3. index.html — Add links to new pages in navigation

Find the footer links section and add:
  <a href="/mock-tests">Mock Tests</a>
  <a href="/blog">Career Blog</a>
  <a href="/interview">Interview Q&A</a>

---

## 4. Supabase SQL Editor — Run supabase-v28-new-features.sql

Go to Supabase → SQL Editor → New Query → paste entire file → Run

---

## 5. GitHub Secrets — Add for GitHub Actions

Go to GitHub repo → Settings → Secrets and variables → Actions → New repository secret:
  OWNER_KEY = [your owner key]
  SITE_URL = https://civilcareer-india-two.vercel.app
