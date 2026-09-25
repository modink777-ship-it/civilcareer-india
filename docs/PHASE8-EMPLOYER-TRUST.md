# CivilCareer Phase 8 — Employer & Verification Layer

## Scope
This phase adds an employer trust layer without replacing the existing job/source verification workflow.

### Added
- `api/employers.js`: owner-managed employer profiles and verification, plus public access to verified profiles only.
- `supabase-v13-employer-trust.sql`: additive schema for employer profiles and job/submission associations.
- Public job projection now carries employer verification state/profile id.
- Admin submissions area now includes employer verification controls.
- Verified employer state is surfaced as a separate candidate-facing badge.
- Existing `/api/reports` remains the candidate reporting path for suspicious, incorrect, expired, broken-link and other content reports.

## Verification workflow
1. Candidate/employer submits a vacancy through the existing employer submission endpoint.
2. Administrator reviews the original official URL and vacancy details.
3. Administrator can create/update an employer profile with official URL and status.
4. When a profile is marked `Verified`, matching jobs are associated with that employer profile and receive `employer_verification_status=Verified`.
5. Candidates see an explicit `Employer verified` signal on public cards.
6. Verification does not replace source verification; candidates are still told to check the original employer/official source before applying.

## Safety
- Public employer endpoint returns only `Verified` profiles.
- Employer mutations require the owner key.
- Official URL must be HTTP/HTTPS.
- No automatic publication is introduced.
- Existing report workflow remains available for candidate feedback.

## Database rollout
`supabase-v13-employer-trust.sql` is additive and was not executed against production. Review the current production schema before applying it.

## Cost / infrastructure
- No paid service introduced.
- No external verification vendor introduced.
- No production data was modified by this phase.

## Limitations
- Employer identity/KYC is not claimed. "Employer verified" means CivilCareer has an administrator-reviewed employer profile and official URL; it is not a legal certification of the company.
- Automatic external corporate-registry verification is intentionally deferred.
- Email-domain ownership verification is intentionally deferred until an appropriate low-cost delivery flow is selected.
