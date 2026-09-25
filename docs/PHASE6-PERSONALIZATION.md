# CivilCareer Phase 6 — Personalization & Candidate Workflow

## Scope

Phase 6 connects the optional candidate account layer to the candidate workflow without making sign-in mandatory.

### Implemented
- Authenticated account GET now returns profile, saved-job IDs, application tracking data, and a server-generated recommendation feed.
- Recommendations use role, location, career stage, skills, project preference, work preference, environment, education, freshness and source-verification signals.
- Saved and already-tracked applications are excluded from the recommendation feed so the feed focuses on additional opportunities.
- Recommendation output contains explainable reasons, not match percentages or candidate rankings.
- Recommendation computation is bounded to the newest 120 published, non-expired jobs to keep account requests predictable.
- Existing localStorage guest mode remains intact.
- Existing cross-device profile/saved/application sync remains intact.

## Safety and data handling

- Recommendations require an authenticated candidate token.
- Account API remains `private, no-store`.
- No service-role key is exposed to the browser.
- No production database migration is performed by this phase.
- No candidate data is deleted or transformed destructively.
- No political or sensitive-profile inference is performed.

## Known limitation

The recommendation feed is a bounded heuristic feed rather than a machine-learning model. It should be treated as a convenience layer and not as a guarantee of suitability. Users should verify each job's requirements at the original source.
