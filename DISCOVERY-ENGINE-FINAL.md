# CivilCareer Discovery Engine — Final

## Workflow

Public/official sources -> source fetch -> civil relevance filter -> AI/local normalization -> duplicate check -> Pending Review draft -> admin review -> publish.

Nothing discovered is published automatically.

## Sources

The engine uses a mix of official/public sources and public search feeds. LinkedIn and Naukri are external-only shortcuts unless an authorized API/feed is supplied; CivilCareer does not scrape protected platforms.

Configured source families include:
- National Career Service (NCS)
- UPSC recruitment advertisements
- SSC notice board
- KPSC / Karnataka PSC
- Google News public RSS searches for civil roles and government recruitment
- Google News public search mentions for Naukri and LinkedIn (not direct scraping)

## AI pipeline

If keys exist in Vercel/GitHub secrets:
1. Groq
2. Gemini
3. deterministic local extraction

Discovery works without AI keys.

## Review

Every discovered record is unpublished and marked Pending Review. Admin can review, edit, publish, unpublish or delete it. Publication time is stamped when the admin publishes the job.

## Free-only design

No paid scraping platform, paid job database, or mandatory paid AI service is used.
