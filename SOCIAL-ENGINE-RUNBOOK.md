# CivilCareer Social Engine Runbook

## 1. Before the first real Telegram publication

Confirm in Vercel:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHANNEL_ID`
- `LEGACY_TELEGRAM_AUTOPOST=true`

The existing public CivilCareer channel is the production destination.

No private test channel is required.

## 2. Telegram permissions

The CivilCareer bot must be an administrator of the channel and have permission to post.

The Social Engine uses the official Telegram Bot API.

## 3. First real test

Do not publish an artificial "TEST" message.

Use one legitimate verified CivilCareer job or exam suggestion.

In Admin -> Social Engine:

1. Preview
2. confirm Truth Lock
3. Approve
4. confirm Telegram is the intended destination
5. publish Telegram

For this project the first real test is a normal approved post to the existing public channel.

## 4. If a Telegram request times out

Do not click Retry immediately.

Open the ledger.

A timeout/ambiguous result is marked `uncertain`.

Check the public Telegram channel manually.

If the post exists:
- Mark Published / resolve the ledger.

If the post definitely does not exist:
- Retry from the ledger.

This prevents duplicate announcements.

## 5. Markdown errors

The legacy private-job publisher may retry a definite Telegram Markdown parse failure once using plain text.

A timeout, network ambiguity or unknown response is NEVER treated as a Markdown error and is NEVER auto-retried.

## 6. Kill switch

Admin -> Social Engine -> Kill switch.

When ON:
- new publication attempts are blocked
- the scheduled drain is blocked
- manual publish is blocked

Turn it OFF only when publication is intentionally resumed.

## 7. Daily caps

The default Telegram cap is 5 real attempts per day.

Caps use the configured timezone, default:

Asia/Kolkata

Uncertain attempts count toward the cap.

Test ledger rows do not count.

## 8. Legacy private-job transition

Keep:

`LEGACY_TELEGRAM_AUTOPOST=true`

during the private-job transition.

Do not turn it off until the Social Engine can safely consume private jobs and the migration has been tested.

## 9. GitHub Actions scheduler

The Social Engine scheduler is a Phase 2 feature.

Planned configuration:

- `SOCIAL_CRON_SECRET` in Vercel
- the same value as a GitHub Actions repository secret
- schedule approximately every 30–60 minutes

GitHub scheduled workflows are best-effort and may be automatically disabled after long repository inactivity (approximately 60 days for public repositories).

Admin "Run now" is the fallback.

## 10. LinkedIn

Phase 4:

- create/use LinkedIn developer app
- enable the official Share on LinkedIn product
- authorize the personal LinkedIn account
- obtain a member access token
- configure `LINKEDIN_ACCESS_TOKEN`
- configure `LINKEDIN_AUTHOR_URN`

Do not configure an organization author for the personal-profile phase.

## 11. Instagram

Phase 5:

- use an eligible Instagram Professional account
- use the currently documented official Instagram Login publishing route when appropriate
- configure the required Meta access token and account ID
- create media container
- publish container in a separate request

Do not use browser automation.

## 12. WhatsApp

Phase 1 uses manual sharing only.

Do not use WhatsApp Web automation, browser scripting, session persistence or unofficial wrappers.

## 13. Credential rotation

Rotate a credential when:

- it is exposed
- a provider marks it compromised
- the app owner changes
- a token expires

Never paste tokens into chat or commit them to GitHub.

## 14. Preview deployment testing

Use the `social-engine` branch.

Deploy that branch as a Vercel Preview.

Set the Preview environment variables separately.

Test:

- Admin authentication
- Social queue load
- content preview
- Truth Lock
- approval
- manual publish control
- no-secret responses
- no accidental production deployment

Do not merge to `main` until the Preview passes.

## 15. Safe shutdown

If anything looks wrong:

1. turn ON the Social Engine kill switch
2. stop scheduled workflow runs if Phase 2 is active
3. inspect the publication ledger
4. do not retry uncertain sends until the channel is checked
5. rotate credentials if any secret was exposed

