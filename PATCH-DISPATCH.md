# Dispatch Router Patch

Open `api/[[...path]].js` and make these two changes:

## 1. Add govt-discovery to the route map

Find the block that lists routes (looks like this):
```js
  '/api/telegram': () => require('../_api/telegram'),
```

Add this line immediately after it:
```js
  '/api/govt-discovery': () => require('../_api/govt-discovery'),
```

## 2. Verify agent-reach-ingest is registered

Search the file for `agent-reach-ingest`. If it's NOT there, add:
```js
  '/api/agent-reach-ingest': () => require('../_api/agent-reach-ingest'),
```

in the same route map block.

## Full route map should include (at minimum):
```js
  '/api/telegram':           () => require('../_api/telegram'),
  '/api/govt-discovery':     () => require('../_api/govt-discovery'),
  '/api/agent-reach-ingest': () => require('../_api/agent-reach-ingest'),
  '/api/discovery':          () => require('../_api/discovery'),
  '/api/jobs':               () => require('../_api/jobs'),
  '/api/exams':              () => require('../_api/exams'),
  '/api/exam-alerts':        () => require('../_api/exam-alerts'),
  '/api/study-materials':    () => require('../_api/study-materials'),
```

That's all — no other changes needed in this file.
