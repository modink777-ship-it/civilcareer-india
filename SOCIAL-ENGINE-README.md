# CivilCareer Social Content Engine

## Phase 1 status

Phase 1 provides a verified-data social content queue with deterministic templates, Truth Lock, human approval, Telegram publishing, duplicate protection, manual WhatsApp sharing, safety controls and testable platform adapters.

The current production Telegram destination is the existing CivilCareer public channel configured by `TELEGRAM_CHANNEL_ID`.

No separate Telegram test channel is required. `TELEGRAM_TEST_CHANNEL_ID` remains an optional isolated-test setting only; leaving it empty is the normal production configuration.

## Architecture

Agent Reach / Jobs / Exam Tracker
-> verified source record
-> Social Content Engine suggestion
-> Truth Lock
-> admin approval
-> one platform per publish request
-> publication ledger

Agent Reach remains the discovery layer. The Social Engine does not create a second government crawler.

## Verification

Government-job social suggestions require:

- active `govt_jobs` row
- `reviewed_at` set
- at least one verified Civil vacancy

Published private jobs are eligible as `job` sources, but their legacy direct Telegram path remains enabled by default until private-job migration is completed.

Exam Tracker rows must be active.

## Truth Lock

The engine stores a source truth hash when a suggestion is created.

At edit, approval and publish time it checks the live source again.

A changed deadline, vacancy, status, exam date or URL invalidates stale approval.

Generated content is also checked for:

- unsupported numbers
- wrong Civil vacancy numbers
- unsupported URLs
- platform length limits

Example: a source with 487 Civil vacancies must never produce 500, 500+ or 1000 as the Civil vacancy figure.

## Telegram

Telegram publishing uses the official Bot API and:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHANNEL_ID`

The bot must be an administrator of the destination channel.

Real publishing requires:

1. verified source
2. Truth Lock pass
3. explicit admin approval
4. current source hash
5. kill switch OFF
6. daily-cap headroom
7. no existing real ledger send

A definite Telegram API error is recorded as a failure.

A timeout or ambiguous network result is recorded as `uncertain` and is never automatically retried.

The legacy private-job path keeps its existing Markdown fallback for definite parse errors. Social Engine Telegram content is plain text, so it does not need a Markdown parse fallback.

## Admin workflow

Open Admin -> Social Engine.

For each suggestion:

- Preview
- Edit
- Approve
- Publish Telegram
- Publish Everywhere
- Copy WhatsApp
- View ledger
- Retry/resolve failed or uncertain sends

Publish Everywhere is browser orchestration: each platform is a separate HTTP request. The API itself accepts one platform per publish request so a Vercel invocation does not become a long multi-platform worker.

Phase 1 only enables Telegram for actual publication. LinkedIn and Instagram remain disabled until their approved phases.

## WhatsApp

Ordinary WhatsApp Group auto-posting is not supported through an official free API route.

Phase 1 provides:

- Copy for WhatsApp
- manual share workflow
- optional `wa.me/?text=` helper

No WhatsApp Web automation or unofficial wrapper is used.

## LinkedIn

Phase 4 target: personal LinkedIn profile through the official member-sharing route.

Company-page publishing is a separate official-permission path and is not enabled by Phase 1.

## Instagram

Phase 5 target: official Instagram publishing for a professional account.

The approved architecture is two requests:

1. create media container
2. publish the container

The current Phase 1 adapter is disabled until Phase 5.

## Zero-cost design

The core engine does not require an AI API.

Content is generated with deterministic JavaScript templates.

No paid scheduler, queue, database, image generator or social SaaS is required.

## Scheduling

Automatic sub-daily scheduling belongs to Phase 2.

The planned scheduler is GitHub Actions calling the protected Social Engine drain endpoint.

Use an Admin "Run now" action as a manual fallback.

The repository documentation should note that GitHub may automatically disable scheduled workflows in public repositories after extended inactivity (approximately 60 days).

## Secrets

Never commit or expose:

- `OWNER_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `LINKEDIN_ACCESS_TOKEN`
- `META_ACCESS_TOKEN`
- other platform credentials

Credentials belong only in Vercel/GitHub secret storage as appropriate.

## Current phase boundary

Do not disable `LEGACY_TELEGRAM_AUTOPOST` for private jobs yet.

That flag defaults to ON.

It may be turned OFF only after private jobs are fully routed through the Social Engine in a later phase.
