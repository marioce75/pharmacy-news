# Medication affordability directory: verification record

Page: `GET /affordability`. Data: `config/affordability.js`. Rules and filters: `lib/affordability.js`.

Checked on **2026-11-09** with plain `curl` (descriptive User-Agent, redirects followed, no cookies, no login, no browser emulation). 36 GET requests in total, at most two per host except where a first address was wrong or redirected. Page bodies were kept outside the repository and are not stored here.

A resource is **verified** only if its own page returned HTTP 200 and the facts in its `evidence.confirmed` list were read in the response on that date. Anything else is **unverified**: it sits in the `UNVERIFIED` export and is never shown on the public page.

## Verified (shown publicly): 20

| Resource | URL listed | HTTP | Checked | Note |
|---|---|---|---|---|
| Medicare: Help with drug costs (Extra Help) | https://www.medicare.gov/basics/costs/help/drug-costs | 200 | 2026-11-09 | Also the source for the Medicare statement about discount cards and for the pointer to state pharmaceutical assistance programmes |
| HealthCare.gov: Saving money on health insurance | https://www.healthcare.gov/lower-costs/ | 200 | 2026-11-09 | Coverage screening (Marketplace, Medicaid, CHIP) |
| Medicaid.gov: Where can people get help with Medicaid and CHIP? | https://www.medicaid.gov/about-us/where-can-people-get-help-medicaid-chip | 200 | 2026-11-09 | State contact list. The first page tried (`/medicaid/eligibility-policy`, 200) is written for states and was not used |
| FDA BeSafeRx | https://www.fda.gov/drugs/buying-using-medicine-safely/besaferx-your-source-online-pharmacy-information | 200 | 2026-11-09 | Older quick-tips address redirected here. Page content dated September 2020 |
| America's Medicines (PhRMA) | https://americasmedicines.com/ | 200 | 2026-11-09 | `mat.org` redirected here. `medicineassistancetool.org` timed out. See owner decisions |
| HealthWell Foundation | https://www.healthwellfoundation.org/ | 200 | 2026-11-09 | Fund list showed many funds closed on the check date |
| Good Days | https://mygooddays.org/ | 200 | 2026-11-09 | `www.` redirected to bare domain |
| NORD RareCare patient assistance | https://rarediseases.org/patient-assistance-programs/ | 200 | 2026-11-09 | |
| Dispensary of Hope | https://www.dispensaryofhope.org/ | 200 | 2026-11-09 | |
| Get Insulin (Beyond Type 1) | https://beyondtype1.org/get-insulin/ | 200 | 2026-11-09 | `getinsulin.org` redirected here |
| Lilly Insulin Value Program | https://insulins.lilly.com/lilly-insulin-value-program | 200 | 2026-11-09 | `insulinaffordability.lilly.com` redirected here. `lilly.com/insulin-affordability` returned 404 |
| NovoCare: Help with insulin costs | https://www.novocare.com/diabetes/help-with-costs/help-with-insulin-costs.html | 200 | 2026-11-09 | |
| Sanofi patient support | https://www.sanofi.us/en/your-health/patient-support | 200 | 2026-11-09 | `sanofi.us/en/insulin-affordability` returned 404. The insulin savings detail is on a linked Sanofi site (teamingupfordiabetes.com) that was not fetched |
| GoodRx | https://www.goodrx.com/ | 200 | 2026-11-09 | Commercial |
| Walmart low-cost Prescription Program | https://www.walmart.com/cp/4-prescriptions/1078664 | 200 | 2026-11-09 | Commercial |
| 211 (United Way) | https://211.org/ | 200 | 2026-11-09 | `www.` redirected to bare domain |
| NHS prescription prepayment certificate | https://www.nhs.uk/nhs-services/prescriptions/save-money-with-a-prescription-prepayment-certificate-ppc/ | 200 | 2026-11-09 | England. NHS shows next content review due 27 November 2026 |
| NHS Low Income Scheme | https://www.nhs.uk/nhs-services/help-with-health-costs/nhs-low-income-scheme-lis/ | 200 | 2026-11-09 | England |
| PBS Safety Net | https://www.pbs.gov.au/healthpro/explanatory-notes/section1/Section_1_5_Explanatory_Notes | 200 | 2026-11-09 | Australia. Health-professional explanatory notes; `/info/healthpro/...` redirected here |
| Prescription drugs in Canada | https://www.canada.ca/en/health-canada/services/health-care-system/prescription-drugs.html | 200 | 2026-11-09 | Canada. Older address redirected here. The linked provincial and territorial list was not fetched |

The exact facts confirmed for each entry are in its `evidence.confirmed` array in `config/affordability.js`.

## Unverified (not shown publicly): 9

| Candidate | URL tried | HTTP | Checked | Reason |
|---|---|---|---|---|
| Social Security: Extra Help | https://www.ssa.gov/medicare/part-d-extra-help | 403 | 2026-11-09 | Automated request refused. Extra Help is covered by the Medicare.gov entry |
| HRSA Find a Health Center | https://findahealthcenter.hrsa.gov/ | 200 | 2026-11-09 | Script-loaded shell with no readable text. Second try at `bphc.hrsa.gov/about-health-center-program/what-health-center` returned 403. Sliding-fee and 340B statements not confirmed |
| NeedyMeds | https://www.needymeds.org/ | 200 | 2026-11-09 | Script-rendered; no readable text on the home page or `/pap` |
| RxAssist | https://www.rxassist.org/ | 200 | 2026-11-09 | Page was read, but held for an owner decision: operator shown is RxVantage, nonprofit status is not stated, and the page promotes its own savings card with a savings claim |
| PAN Foundation | https://www.panfoundation.org/ | 403 | 2026-11-09 | Automated request refused |
| Patient Advocate Foundation Co-Pay Relief | https://copays.org/ | 403 | 2026-11-09 | Redirected to `totalassist.org`, which refused the request. The change of domain needs a human look |
| NABP Safe Pharmacy: Buy Safely | https://safe.pharmacy/buy-safely/ | 403 | 2026-11-09 | Automated request refused |
| SingleCare | https://www.singlecare.com/ | 403 | 2026-11-09 | Automated request refused |
| Mark Cuban Cost Plus Drug Company | https://costplusdrugs.com/ | 403 | 2026-11-09 | Bot-protection page |

No attempt was made to get round a refusal (no changed User-Agent, no challenge solving).

## Content rules for every entry

- https URL on the organisation's own domain, identical host to the page actually checked. No query string, fragment, affiliate or tracking parameter.
- No prices, currency or percent signs, savings figures, income thresholds, or the words cheapest, lowest price or guarantee. The linked page carries the current figures.
- Paraphrase; do not copy sentences.
- Discount tools and low-cost pharmacies must be `commercial: true`.
- `evidence.http_status` must be 200. A page that was not read cannot be listed.

`lib/affordability.js` enforces these when the module loads, so a bad edit stops the app from starting. `node --test tests/affordability.test.js` covers the same rules.

## Re-verification: the 90-day rule

A card shows "Link checked <date>" while `verified_at` is 90 days old or less. From day 91 it shows a visible "Check may be out of date" badge. For the 2026-11-09 checks that badge appears from **2027-02-08**.

To re-verify an entry:

1. Open the `url` in a browser (or `curl -sSL -A "<descriptive agent>" <url>`). Record the final address after redirects and the HTTP status.
2. Read the page. Confirm every item in `evidence.confirmed` and every item in `limitations` and `who_it_may_help` is still true. Rewrite any that are not.
3. If the address redirected to a different page, set both `url` and `evidence.final_url` to the new address, but only if it is still the organisation's own site.
4. Set `verified_at` to the date you read the page. Do not bump the date without reading the page.
5. If the page is gone, blocked or no longer says what the entry says, move the entry to `UNVERIFIED` with the reason.
6. Run `node --test tests/affordability.test.js`.

To promote an unverified candidate: read its page by hand, then add a full entry to `RESOURCES` (with an `evidence` block listing what you read) and delete it from `UNVERIFIED`.

Check sooner than 90 days for: the NHS prepayment page (NHS review due 27 November 2026), foundation fund lists (open and closed funds change week to week), and anything tied to a calendar year (Medicare limits, PBS thresholds, manufacturer card terms) each January.
