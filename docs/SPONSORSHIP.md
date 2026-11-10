# Advertising and sponsorship module

Self-contained module for labelled advertising. Both switches are **off by default**: the
enquiry form is closed and nothing is displayed until the owner turns them on.

## Files

| File | Purpose |
| --- | --- |
| `lib/sponsors.js` | Storage, validation, slot allowlist, `activePlacements`, `publicView`, audit log |
| `routes/sponsors.js` | `publicRouter` (`/advertise`) and `adminRouter` (`/sponsors`, mounted under `/admin`) |
| `views/advertise.ejs` | Public policy page and enquiry form |
| `views/partials/sponsor-slot.ejs` | The labelled block shown to readers |
| `views/admin/sponsors.ejs` | Editor review page |
| `tests/sponsors.test.js` | `node --test tests/sponsors.test.js` |

## Environment flags

| Flag | Default | Effect when exactly `true` |
| --- | --- | --- |
| `SPONSOR_SUBMISSIONS_ENABLED` | off | Opens the enquiry form. When off, the form is rendered disabled and `POST /advertise/submit` returns 503. |
| `SPONSOR_DISPLAY_ENABLED` | off | Lets `activePlacements()` return approved, in-date placements. When off it always returns `[]`. |

`CONTENT_DIR` (existing) decides where data is stored: `<CONTENT_DIR>/sponsors/`.

## Mounting (server.js)

Mount both before the existing public and admin routers:

```js
const sponsorRoutes = require('./routes/sponsors');
app.use('/', sponsorRoutes.publicRouter);
app.use('/admin', sponsorRoutes.adminRouter);
```

## Showing a slot on a page

Only three slot names exist: `news-list`, `article-footer`, `newsletter`. Any other name
makes `activePlacements()` throw, so a slot cannot be added to clinical tools, treatment
evidence, substance alerts or medication-cost pages by accident.

In the route:

```js
const sponsors = require('../lib/sponsors');
const sponsorPlacements = await sponsors.activePlacements('news-list');
res.render('news', { /* ... */ sponsorPlacements });
```

In the view (path relative to `views/`):

```ejs
<%- include('partials/sponsor-slot', { placements: sponsorPlacements }) %>
```

The partial renders nothing when the array is empty.

## Workflow

1. An organisation sends an enquiry at `/advertise`. It is stored privately with status `new`.
2. An editor opens `/admin/sponsors`, and marks it `under_review` or `declined` (optional note).
3. To run something, the editor creates a placement from that submission and types the
   label (`Advertisement` or `Sponsored`), sponsor name, headline (90), body (240), one
   https link, slot and dates. Nothing is copied from the enquiry. Creating the placement
   is the approval; the submission becomes `placed`.
4. A placement can be withdrawn at any time with a reason. Withdrawal is permanent for that
   placement; create a new one to run it again.

Rules enforced in code: plain text only (`<` and `>` rejected), no web addresses in the
headline or body, https link only, maximum run of 90 days, end date after start date.
Dates are UTC and the end date is included.

## Data

- `sponsors/submissions/<id>.json`: organisation, contact name, business email, website,
  type, proposed copy, status, review note, reviewer id. No IP address is stored.
- `sponsors/placements/<id>.json`: the editor-typed fields, submission id, reviewer ids,
  withdrawal reason.
- `sponsors/audit.jsonl`: one JSON line per action: `at`, `actor`, `action`, `target`.
  Lines are only appended.

Public pages receive only `label`, `sponsor_name`, `headline`, `body`, `link`
(`publicView`).

## Limits to know about

- The rate limit (3 posts per hour per client) is in memory and resets on restart.
- Writes are serialised inside one process. Do not run two server processes against the
  same `CONTENT_DIR`.
- There is no retention or deletion tool for old enquiries; files are removed by hand.
- The module does not send email. Replies to sponsors are made by the owner directly.
- The `newsletter` slot is only a name here; the newsletter sender must call
  `activePlacements('newsletter')` itself.
