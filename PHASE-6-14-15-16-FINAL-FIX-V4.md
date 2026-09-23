# CivilCareer Final Fix V4

## Discovery sources
The Admin Discovery tool currently reads public RSS feeds from Indeed India and Google News RSS for civil-engineering and government-recruitment queries. It imports only new candidates and saves them unpublished for owner review.

## Review workflow
Fetch → deduplicate → save as Draft/unpublished → Admin Jobs → Edit → Publish.

## Important limitation
This is not an "all jobs on the internet" crawler. Public RSS feeds only expose what their feeds return, and protected sites may block automated requests.

## Publication age
Public cards use published_at first. Publishing through Admin stamps the current server time, so age starts at the actual CivilCareer publish moment.
