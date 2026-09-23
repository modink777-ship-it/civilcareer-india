# Exam Prep Button Fix

The Exam Prep navigation item is now a native CivilCareer SPA route (`/exam-guides`) rather than relying only on a static rewrite. This makes the button work consistently on desktop and mobile and displays the eight exam-preparation guides inside the main application. The individual guide links remain crawlable static pages.

The service-worker cache version was bumped so older cached navigation cannot hide the new page.

No paid services and no database changes.
