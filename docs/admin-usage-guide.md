# CivilCareer Admin Guide

The admin dashboard is available at `/admin` and requires a Supabase session
for an allowlisted administrator (`ADMIN_EMAIL` and/or `ADMIN_USER_ID` on the
server). Signing in with an ordinary account does not grant admin access.
Use the dashboard only over HTTPS and sign out on shared devices.

## Recommended job-review workflow

1. Open **Discovery** and run **Search Now**. Check the source status and each
   result; discovery results are leads, not verified vacancies.
2. Verify the employer, India location, civil-engineering relevance, dates and
   application URL against the original source. Use the official board or
   employer career page for government roles. Correct or reject incomplete,
   expired, duplicated or unrelated results.
3. Use **Review Jobs** to find incoming drafts. **Pending Review** contains
   drafts awaiting a decision; **Rejected** keeps rejected items visible;
   **Published** contains public listings; **Deleted** contains soft-deleted
   items that can be restored. Open the source before publishing.
4. Use **Publish** only after checking the listing. Publishing makes the job
   public. The Social Engine has its own approval and delivery settings; check
   those settings before using **Run Now**. Do not assume a social post is
   private or approved without checking its status.
5. Use the separate **Jobs** tab to edit a listing, manage lifecycle status,
   or add a job manually. Review any AI-imported field against the source; AI
   extraction is a drafting aid, not verification.

## Admin tabs

| Tab | What it is for | Safe operating notes |
|---|---|---|
| **Analytics** | Traffic charts and KPI summaries. | Counts depend on available analytics data; a blank/zero value is not proof of no activity. |
| **Jobs** | Edit, add, filter, publish-state manage, and soft-delete the main jobs collection. | Check the original listing and deadline before saving. Use the expired filter intentionally. |
| **Discovery** | Search configured feeds and company pages for India civil-job leads. | Results are not verified listings. Review source details before adding or publishing. |
| **Agent Reach** | Run available job/exam scans and submit YouTube material transcripts. | Scan results and imported content need manual verification before publication. |
| **Exams** | Manage exam records and open the manual exam editor. | PDF text extraction runs locally in the browser; it does not create or verify a record. Scanned PDFs need OCR and manual entry. |
| **Exam Tracker** | Manage dated civil-engineering exam events shown on the public tracker. | Verify dates/statuses against the relevant official notification before saving. |
| **Social Engine** | Review suggestions, connections, settings, previews and the approved-queue drain. | Check approval requirements, platform accounts, daily caps and the kill switch before any delivery action. |
| **Salary** | Manage salary-explorer entries. | Treat submitted or estimated values as unverified until checked against a reliable source. |
| **Walk-Ins** | Add and manage walk-in interview listings. | Confirm date, venue, employer and application/contact details before publishing. |
| **Subscribers** | Review notification subscriber records and subscription state. | Handle personal data only as needed for the requested notification service. |
| **Reviews** | Moderate company reviews. | Check for personal data, abuse and unsupported factual claims before changing moderation state. |
| **Blog** | Draft and manage editorial posts. | Verify links, dates and factual claims; preview before publication. |
| **Interview Q&A** | Moderate interview questions and answers. | Remove personal or confidential interview information and check for accuracy. |
| **Materials** | Manage study resources and learning materials. | Verify rights, source links and relevance before publishing. |
| **Submissions** | Review employer job and resource submissions. | Validate submitter and source details; treat user-submitted content as untrusted. |
| **Reports** | Review reported jobs and other safety/quality concerns. | Investigate the source before hiding or restoring an item; keep the audit trail. |
| **Contact** | Read contact requests and set their status. | Mark messages New, Read, Resolved or Spam as appropriate. |
| **Review Jobs** | Scraper-created job review queue, separated by Pending Review, Rejected, Published and Deleted. | Scraping is best-effort and may find no jobs. Publishing exposes the listing publicly; deletion is soft and restorable. |

## No-cost exam PDF text extraction

In **Exams**, choose a selectable-text PDF under 20 MB and press **Extract
text**. The browser extracts text locally and shows a copyable preview. Use
**+ Add manually** to create the exam record, then enter only values supported
by the official notice and independently verify every date and URL. This
workflow makes no AI-provider request and requires no paid service. A scanned
PDF will need OCR, which this dashboard does not currently provide.

## If data fails to load

Each panel reports its own load error so other tabs remain usable. Retry the
affected panel or reload the dashboard. If an admin API returns 401, sign in
again; if it returns 403, confirm the signed-in account matches the server
allowlist. A missing Supabase table, server environment variable, provider
quota, or platform connection requires an owner-side setup check; do not
interpret an empty panel as evidence that the underlying data was deleted.

All publishing, discovery and notification workflows remain subject to their
configured free-tier quotas. No paid provider is required for the local PDF
text extraction flow.
