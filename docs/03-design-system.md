# Design System — "Blueprint Navy & Brass"

Single source of truth. Ship as `tokens.css` custom properties; **no hard-coded colours anywhere**. Every pair below was chosen against WCAG AA (≥4.5:1 for normal text) in its own theme.

## 1. Tokens

### Light theme (`:root`)

```css
:root{
  --bg:#F7F8FA; --surface:#FFFFFF; --surface-2:#EEF2F7; --border:#E3E7EE;
  --ink:#0B1F3A; --ink-muted:#4A5A70;
  --primary:#0B1F3A; --primary-hover:#14315A; --on-primary:#FFFFFF;
  --accent:#D4A72C; --on-accent:#0B1F3A; --accent-text:#7A5F00;   /* accent never used as body text */
  --govt:#0B6F79; --govt-tint:#E3F3F4;
  --private:#1C5AA0; --private-tint:#E6EEF8;
  --success:#0C6E55; --success-tint:#E2F4EE;   /* Verified */
  --warn:#9A4506; --warn-tint:#FDF0E1;         /* Closing soon */
  --danger:#B42318; --danger-tint:#FDE9E7;     /* Expired / Scam */
  --link:#1D4ED8;
  --radius:12px; --radius-sm:8px;
  --space:8px;   /* 4/8 grid: 4,8,12,16,24,32,48,64 */
  --shadow-1:0 1px 2px rgba(11,31,58,.06),0 1px 3px rgba(11,31,58,.08);
  --shadow-2:0 4px 12px rgba(11,31,58,.10);
  --font-head:'Plus Jakarta Sans',system-ui,sans-serif;
  --font-body:'Inter',system-ui,sans-serif;
  --font-hindi:'Noto Sans Devanagari','Inter',sans-serif;
}
```

### Dark theme (`[data-theme="dark"]`)

```css
[data-theme="dark"]{
  --bg:#071426; --surface:#0E2138; --surface-2:#14304F; --border:#23405F;
  --ink:#EAF0F8; --ink-muted:#9FB0C6;
  --primary:#E6BC4B; --primary-hover:#F0CA5E; --on-primary:#071426;
  --accent:#E6BC4B; --on-accent:#071426; --accent-text:#E6BC4B;
  --govt:#5CD0DB; --govt-tint:rgba(92,208,219,.12);
  --private:#7FB2F0; --private-tint:rgba(127,178,240,.12);
  --success:#3FCF9F; --success-tint:rgba(63,207,159,.12);
  --warn:#F5A524; --warn-tint:rgba(245,165,36,.12);
  --danger:#FF7A6B; --danger-tint:rgba(255,122,107,.12);
  --link:#7FB2F0;
}
```

**Usage ratios:** navy ≈ 60% of the look (backgrounds, headers, ink); brass ≈ 10% — primary CTA + highlights only, never body text (`--accent-text` is the only accent-hued text colour); semantic colours only for their meaning. Government = teal always; private = steel blue always.

## 2. Type & spacing

- Headings: Plus Jakarta Sans, 600–800. Body: Inter 400/500/600. Hindi: Noto Sans Devanagari. All from Google Fonts, `display=swap`.
- Modular scale (mobile-first): 12 · 14 · 16 (base) · 18 · 22 · 28 · 36 · 44 px, line-height 1.2 for headings / 1.6 for body.
- 4/8px spacing grid; 12px radius cards, 8px controls; thin `--border` borders + `--shadow-1`.
- Hero: subtle blueprint grid via CSS `background-image: linear-gradient(...)` lines at 4% opacity — no images, no 3D canvas.

## 3. Core components

**Buttons** — min-height 44px (tap target), radius 8px:
`btn-primary` (navy bg / on-primary text; brass bg in dark), `btn-accent` (brass bg, on-accent text — the one main CTA per view), `btn-secondary` (surface bg, border, ink text), `btn-ghost` (transparent, link colour).

**Badges** — 24px pill, tint bg + semantic text:
`Verified` (success) — only after human review; `Govt` (govt tint); `Private` (private tint); `Closing in 3 days` (warn); `Expired` / `Scam flag` (danger); `New` (neutral surface-2).

**Form fields** — 44px, surface bg, 1px border, focus ring `2px solid var(--link)` + offset; labels always visible (no placeholder-as-label); error text in danger below the field with `aria-describedby`.

**States (mandatory on every list):** Loading = skeleton cards (surface-2 shimmer, honours reduced-motion) — never spinners-on-blank; Empty = icon + one-line reason + next action ("No results — clear filters" / "No closing deadlines this week — subscribe to alerts"); Error = danger tint card with Retry button.

**Motion:** 150–200ms ease-out on hover/focus/panel changes only; everything wrapped in `@media (prefers-reduced-motion: reduce){ *{animation:none;transition:none} }`.

**Theme toggle:** 3-state (Light / Dark / System) in the header; default System; stored in localStorage; no flash (inline snippet sets `data-theme` before first paint).

## 4. Wireframes (360px-first)

### 4.1 New nav (6 items)

```
┌────────────────────────────────────────────┐
│ ☰  CivilCareer        [Search] [◐] [🔔]   │  header 56px, sticky
├────────────────────────────────────────────┤
│ Jobs  Govt  Exams  Prepare  ForYou  Alerts │  horizontal scroll on mobile,
└────────────────────────────────────────────┘  active item = 2px gold underline
Desktop: same six, right-aligned; overflow items never wrap.
Footer (unchanged position): Post a Job · Submit Resource · Report · Legal · About
```

### 4.2 Job listing card / page

```
Card (list):                                Page (/jobs/<slug>):
┌────────────────────────────────┐          ┌────────────────────────────┐
│ [Private] [Verified✓] [New]    │          │ H1 role @ company          │
│ Site Engineer                  │          │ [Private][Verified][Govt?] │
│ L&T Construction · Pune, MH    │          │ ₹4.5–6 LPA (est.) · 2–4 yrs│
│ ₹4.5–6 LPA · 2–4 yrs · 3d ago  │          │ Deadline: 12 Oct 2026 ⏳   │
│ Deadline 12 Oct ⏳             │          │ [Apply on official site ↗] │
│ [Save ♡] [Apply ↗] [⋮]        │          │ [WhatsApp share] [Report]  │
└────────────────────────────────┘          │ Source: larsentoubro.com ✓ │
                                            │ Last verified: 28 Sep 2026 │
                                            │ ... description ...        │
                                            │ [Similar jobs →]           │
                                            └────────────────────────────┘
Missing salary → "Not disclosed · market est ₹X–Y for <role> in <city>" (method note).
```

### 4.3 Government notification page

```
/notifications/<org>-<year>-<slug>
┌────────────────────────────────────┐
│ [Govt] SSC JE Civil 2026 — 1,748   │  H1 + org badge
│ vacancies · BE/Diploma · Central   │
├────────────────────────────────────┤
│ ⏳ Closes in 6 days (18 Oct)       │  countdown strip (warn)
│ [Apply on ssc.gov.in ↗] [PDF ↗]    │  official links only
├────────────────────────────────────┤
│ Vacancies 1,748 · Pay ₹35,400–     │  key facts grid (2-col on ≥480px)
│ 1,12,400 · Fee Gen ₹100 · Age      │
│ 18–27 yrs (+relaxations)           │
├────────────────────────────────────┤
│ Dates: Notif 01 Oct · Start 05 ·   │  timeline component
│ Last 18 Oct · Exam Dec · Result —  │
├────────────────────────────────────┤
│ Posts & category/state breakdown ▸ │  collapsible tables
│ Eligibility ▸ Selection ▸          │
│ Syllabus ▸ What changed vs 2025 ▸  │
├────────────────────────────────────┤
│ Source: ssc.gov.in ✓ Last verified │
│ 29 Sep 2026 · Report a problem     │
└────────────────────────────────────┘
```

### 4.4 Eligibility checker

```
/govt/eligibility  (no login, nothing stored without consent)
┌────────────────────────────────────┐
│ Check which govt posts you can     │  H1
│ apply for — 30 seconds             │
│ Qualification: (Diploma ▾ / BE ▾)  │  step 1
│ DOB: [dd-mm-yyyy]                  │  step 2
│ Category: Gen OBC SC ST EwS PwD ▾  │  step 3
│ State: Karnataka ▾ · Ex-SM ☐      │  step 4
│ [Check my eligibility]             │  brass CTA
├────────────────────────────────────┤
│ ✓ You can apply for 7 live posts   │  result list = notification
│   SSC JE (age ok, BE ok) [why ✓]   │  cards + "why this matches"
│   KPSC AE …                        │  chips
│ "Runs in your browser. Nothing is  │  honest privacy note
│  uploaded."                        │
└────────────────────────────────────┘
```

### 4.5 Alerts flow

```
Homepage (above the fold) + after every listing:
┌────────────────────────────────────┐
│ Never miss a govt civil deadline   │
│ [role ▾] [state ▾] [Govt/Private/  │
│  Both ▾] [Daily ▾/Weekly]          │
│ [email or Telegram handle]         │
│ [Get alerts — free]                │
│ One click to unsubscribe. No spam. │
└────────────────────────────────────┘
Confirm → double opt-in email (Brevo) / Telegram / Web-push permission prompt.
Manage: /alerts-manage?token=… (pause, edit filters, delete all data — DPDP).
```

## 5. Style-guide page

Ship `/styleguide` (a static page rendering every token, badge, button and state live, in both themes) alongside this file during P1-2. It becomes the review surface for every future component.
