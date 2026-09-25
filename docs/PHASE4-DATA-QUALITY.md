# CivilCareer Phase 4 — Data Quality

## Goal

Strengthen the discovery pipeline so only usable, India-relevant civil-engineering vacancy records enter the draft queue, while preserving the existing human-review workflow.

## Changes

### 1. Source URL safety gate
Every discovered source URL must be an explicit HTTP(S) URL. Discovery rejects malformed URLs and local/private-network targets instead of storing unusable or unsafe source links.

Application URLs supplied by a source are also validated. CivilCareer does not fabricate an application URL when the source does not provide one.

### 2. Quality flags for review
Accepted discovery records receive internal quality metadata:

- `missing_company`
- `missing_location`
- `missing_application_url`
- `short_description`
- `trusted_source_location_missing`

These are review signals, not candidate-facing match scores. A trusted India-specific source can still enter the draft queue without a location field because the existing source-specific India rule explicitly permits that case.

### 3. Quality score for admin review
An internal 0–100 quality score is calculated from the presence of the above fields. It is stored with discovery drafts when the current database schema supports the optional columns. The compatibility insert path remains available for older schemas.

This score is **not** a candidate/job match percentage and is not shown as a candidate-facing ranking.

### 4. Existing validation remains intact
The phase preserves the existing gates for:

- civil/construction relevance
- source-specific India evidence
- foreign/Gulf rejection
- news-vacancy filtering
- exact freshness classification
- URL/title deduplication
- human review before publication

### 5. Rejection accounting
Unsafe/malformed source or application URLs are counted as quality rejections in source statistics instead of being mixed into unrelated rejection categories.

## Database policy

No production migration was performed. No existing job records were modified or deleted.

The new quality fields are optional. If the current database does not contain them, the existing compatibility write path can still create the draft without those optional fields.

## Verification

Phase 4 tests cover:

- HTTP(S) source URL acceptance
- JavaScript/local/private URL rejection
- quality flag generation
- clean-record quality flags
- freshness boundary behavior
- existing Phase 1 security tests
- existing Phase 2 stabilization tests

No external production data or credentials were used for these tests.
