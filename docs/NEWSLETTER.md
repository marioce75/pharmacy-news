# Newsletter

The newsletter emails a released daily edition to people who signed up and confirmed
their address. Everything is **off by default**, and there is **no real email provider**
in the code: the owner has not chosen or approved one. Until an adapter is written
(see "Adding an email provider"), the only working transport is `dry-run`, which writes
each message to a file and never contacts a network.

## Files

| File | Purpose |
| --- | --- |
| `lib/newsletter.js` | Subscribers, issue building, outbox, transports |
| `routes/newsletter.js` | Public pages and admin pages |
| `views/newsletter.ejs`, `views/newsletter-action.ejs` | Public sign-up page; confirm / unsubscribe / result page |
| `views/admin/newsletter.ejs` | Admin page (counts, switches, preview, queue) |
| `scripts/newsletter-send.js` | The only way an issue is sent |
| `tests/newsletter.test.js` | `node --test tests/newsletter.test.js` |

## Mounting (server.js)

```js
const newsletterRoutes = require('./routes/newsletter');
app.use('/', newsletterRoutes.publicRouter);        // next to the other public routes
app.use('/admin', newsletterRoutes.adminRouter);    // BEFORE app.use('/admin', adminRoutes)
```

The admin router applies `requireAdmin` itself. It needs the session middleware, which
server.js already installs earlier.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `NEWSLETTER_SIGNUP_ENABLED` | off | Must be exactly `true` to accept sign-ups |
| `NEWSLETTER_SENDING_ENABLED` | off | Must be exactly `true` to queue or send issues |
| `NEWSLETTER_TRANSPORT` | `none` | `none` or `dry-run`. Any other value is treated as `none` |
| `NEWSLETTER_POSTAL_ADDRESS` | unset | Postal address printed in every email. Required |
| `PUBLIC_SITE_URL` | unset | Must start with `https://`. Used for confirm, unsubscribe and edition links. Required |

Sign-up is open only when the sign-up switch is on **and** the transport is not `none`
**and** the postal address and https site URL are set. Otherwise `/newsletter` says
sign-up is not open, shows the form disabled, and `POST /newsletter/subscribe` answers
503 and stores nothing. Sending has the same conditions with the sending switch.
The admin page shows which condition is missing.

## What is stored

Under `<CONTENT_DIR>/newsletter/`:

| Path | Contents |
| --- | --- |
| `subscribers.json` | One record per sign-up (see below) |
| `secret.key` | Random key used to create unsubscribe links. **Back it up with `subscribers.json`** |
| `outbox/<day>.json` | Per-recipient send state for a queued issue, by subscriber id. No addresses |
| `dry-run/*.json` | Messages written by the dry-run transport. They contain addresses and working links: delete after inspection |

A subscriber record holds the email address (lower case), a hash of it, the consent
wording version and time, and hashes of the two tokens. It does **not** hold an IP
address, a name, a profession, or any health or profile information.

Tokens are stored only as SHA-256 hashes. The confirmation token is random and lasts
7 days. The unsubscribe token never expires; it is derived from the subscriber's random
id and `secret.key`, so it can be re-created for each issue without being stored.
If `secret.key` is lost, links in emails already sent keep working, but new issues cannot
be sent to existing subscribers (those recipients are marked `gave_up` rather than
mailed without a working unsubscribe link).

## Sign-up (double opt-in)

1. The visitor enters an address and ticks the consent box on `/newsletter`.
   The record is `pending`. A confirmation email goes out through the transport.
2. The email links to `/newsletter/confirm?token=…`. **Opening the link only shows a
   page with a button**, because mail scanners open links automatically. Pressing the
   button (a POST) makes the record `active`.
3. A pending record that is not confirmed within 7 days is deleted the next time the
   subscriber file is written.

The page shown after sign-up is identical whether the address is new, already pending
or already subscribed, so the form cannot be used to check who is subscribed. An active
address is not mailed again, and a pending one is not re-mailed within 10 minutes.
Sign-up posts are limited to 5 per hour per client, must come from this site, and a
hidden field catches simple bots.

## Unsubscribe

Every email carries a personal link to `/newsletter/unsubscribe?token=…` in the body and
in the `List-Unsubscribe` header, plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
so mail programs can offer their own unsubscribe button. The link page has a button; the
POST deletes the email address and leaves a tombstone (`unsubscribed`, hashed email,
hashed token). The address is not mailed again unless the person signs up and confirms
afresh, and an issue queued before they left skips them.

## Building and sending an issue

Nothing is scheduled. The steps are manual:

1. An editor releases the daily edition as usual.
2. At `/admin/newsletter`, preview the date. The issue is built **only** from the
   released edition and its articles that are still published at exactly the revision the
   edition pinned (the same rule as the public `/edition/<day>` page). Withdrawn or
   corrected articles, and any without an https source link, are left out and counted.
   Each item has the headline, source name, publication date, link to the original source
   and the reviewed summary. Article bodies are never included. If there is no released
   edition, or nothing is left in it, there is no issue.
3. An editor ticks the review box and presses **Queue**. This snapshots the confirmed
   subscribers into `outbox/<day>.json`. A day can be queued once. Queuing sends nothing.
4. On the server: `node scripts/newsletter-send.js 2026-11-09` shows what would be sent.
   Add `--confirm` to send. Run it again later to retry failures.

Retries: a failed message waits 5 minutes, then 30 minutes, 2 hours and 8 hours before the
script will try it again; after the fifth failed attempt it is marked `gave_up`. State is
saved after every recipient. The issue is rebuilt at send time, so an article withdrawn
after queuing is not sent.

## Adding an email provider (not done; owner decision)

A transport is a plain object:

```js
{
  name: 'provider-name',          // shown in logs and the admin page; must not be 'none'
  async send({ to, subject, html, text, headers }) { /* ... */ }
}
```

An adapter must:

- send exactly one message to the single address `to`, with both the `html` and `text` parts;
- pass through every entry of `headers` unchanged (`List-Unsubscribe` and
  `List-Unsubscribe-Post`). If the provider cannot set these two headers, do not use it;
- set the From address itself (for example from a `NEWSLETTER_FROM` setting) on a domain
  with SPF, DKIM and DMARC set up;
- **resolve only when the provider accepted the message, and throw on any failure**
  (network error, non-success response, timeout). The outbox counts a throw as a failed
  attempt and retries it; anything else is recorded as sent;
- use a timeout, so one stuck request cannot hang the send script;
- **turn off the provider's click tracking and open tracking**, and not add images,
  footers or link rewriting. The emails are built without any tracking;
- not log message bodies or addresses, and not put an address in a thrown error if it can
  be avoided (stored error text is scrubbed of anything that looks like an address);
- read its API key from an environment variable, never from a file in the repository.

To wire it in: add the adapter file, add its name to `transportName()` and `getTransport()`
in `lib/newsletter.js`, add tests with a fake HTTP client, and document the new
`NEWSLETTER_TRANSPORT` value here.

## Limits to know about

- Delivery is "at least once". If the process dies between a successful send and saving
  that fact, one recipient can receive a second copy.
- The send script and the web server are separate processes. The script only reads the
  subscriber file and only updates outbox files that already exist. Do not run two copies
  of the script at once; there is no lock between them.
- The rate limit is in memory, per process, and resets on restart.
- Bounces and spam complaints are not processed. A provider adapter will need a way to
  feed those back (for example by unsubscribing the address); this is not built.
- The subscriber file is plain JSON on the content disk. Anyone who can read that disk can
  read the addresses. The email hash kept after unsubscribing is an unsalted SHA-256, so
  someone holding the file could test whether a specific address was once subscribed.
- The sign-up response text is identical in every case, but its timing is not equalised
  (a new address takes slightly longer because a message is written).
- The consent wording, postal address, sender identity and the legal basis for mailing
  (CAN-SPAM, and GDPR/PECR if EU or UK readers subscribe) need the owner's review before
  sign-up is switched on.
