# Data quality and government-source status

## Rules
- India-only and civil-only.
- Nothing auto-publishes.
- Government records should use official `.gov.in`, `.nic.in` or official PSU/board domains where an official source is available.
- Every government record should retain source URL and last-verified date.
- Unverified fields should display `Not disclosed` / `Check official notification`, not blank invented values.

## Exam Alerts
Updated source set:
- Employment News announcements: `https://employmentnews.gov.in/empnewsnewfront/all-announcements`
- UPSC active exams: `https://www.upsc.gov.in/examinations/active-exams`
- SSC official: `https://ssc.gov.in/`
- RRB recruitment notices: `https://www.rrbcdg.gov.in/employment-notices.php`

The scanner now fetches sources concurrently, uses a 4.5-second per-source timeout, bounds response size, tolerates partial source failures, and batches unpublished inserts. Results remain `published=false` / `review_state=Pending Review`.

## Important limitation
This package-level run could not reach the public internet from its execution environment, so successful production fetching of each source is not claimed. The configured URLs were checked against current provider pages before being recorded in this package.
