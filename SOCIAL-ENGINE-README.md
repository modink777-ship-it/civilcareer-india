# CivilCareer Social Content Engine

## Purpose
One verified CivilCareer record becomes platform-specific content, passes Truth Lock, waits for human approval, then publishes through the single Social Engine and its publication ledger.

## Sources
- approved government jobs with reviewed civil posts
- active Exam Tracker rows
- reviewed private jobs

Source events create pending suggestions only. Human approval is mandatory and
cannot be disabled; the scheduled drain only processes previously approved
content. The legacy direct Telegram and Morning Brief broadcast routes are
retired.

## Architecture
Verified source → deterministic platform templates → Truth Lock → human approval → per-platform publish → social_publishes ledger → roll-up status

Agent Reach remains the government discovery layer. The Social Engine does not create another crawler.

## Telegram
Production variables: TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID.
Optional isolated test destination: TELEGRAM_TEST_CHANNEL_ID.
The engine uses the official Telegram Bot API. Test sends use is_test=true and do not consume real caps or roll-up status.

## LinkedIn
The current phase is member/personal-profile publishing through the official LinkedIn Posts API.
Variables: LINKEDIN_ACCESS_TOKEN, LINKEDIN_AUTHOR_URN, LINKEDIN_API_VERSION=202609.
Organization/company-page publishing is intentionally not enabled by the personal-profile phase.

## Instagram
The current implementation uses the official Instagram API with Instagram Login on graph.instagram.com.
Variables: INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID, INSTAGRAM_API_VERSION=v26.0.
Publishing is two-step: create a media container using a public JPEG image_url, then later check readiness and call media_publish.
The ledger records needs_second_step, expired, failed, uncertain or sent explicitly. A follow-up request can check readiness only once per 60 seconds, and containers older than 24 hours are expired.

## Truth Lock
At generation, edit, approval and publish time, protected facts are checked against the live source row. A stale source or changed approved content invalidates the action.
Protected facts include organization, post names, Civil vacancy counts, deadlines, application start, qualification, age limit, pay, location, exam date, official/apply URL. Date claims such as an application deadline are checked against their corresponding source fields instead of any unrelated source date. Government snapshots include the verified `govt_job_posts` Civil child rows so a change to a post or its vacancies invalidates an older suggestion.
Missing facts are omitted or shown as to be announced. Multi-post notifications must distinguish total notification vacancies from Civil vacancies.

## Daily Radar
The Admin Social tab includes a read-only Daily CivilCareer Radar preview. It computes due events from verified records and returns platform-specific content without inserting suggestions or sending posts.
The preview reports writes_performed: 0 and sends_performed: 0.

## Safety controls
Publishing is blocked by the kill switch, mandatory human approval, Truth Lock failure, stale approval/content hash mismatch, duplicate ledger rows, daily caps, or missing platform credentials.
Telegram timeouts are uncertain and never auto-retried. Instagram ambiguous responses are also retained explicitly.

## WhatsApp
WhatsApp auto-posting to personal or group chats is not supported. The Admin offers copy and a `wa.me` share link; the operator must review and send manually. No browser/session automation is used.

## Scheduling
The sub-daily Social Engine drain is designed for GitHub Actions, not a Vercel Hobby cron. The protected social-cron route uses SOCIAL_CRON_SECRET and constant-time comparison. Owner credentials are accepted only in request headers, never query strings.

## Transition state
Private-job and exam source events flow into the Social Engine queue instead of bypassing approval and Truth Lock. Platform readiness distinguishes configured credentials from independently verified permissions; LinkedIn and Instagram remain unverified until a real approved publish succeeds.