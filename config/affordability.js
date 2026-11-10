'use strict';
/*
 * Medication affordability directory.
 *
 * Every entry in RESOURCES was fetched from the organisation's own site on the
 * verified_at date and the facts in evidence.confirmed were read on that page.
 * Rules (enforced by lib/affordability.js at module load):
 *   - https URLs on the organisation's own domain, no query string or tracking parameters
 *   - no prices, currency or percent signs, savings claims or income thresholds
 *     (they change; the linked page carries the current figures)
 *   - paraphrase only; do not copy sentences from the pages
 * Candidates that could not be read (blocked, script-only, or needing an owner
 * decision) live in UNVERIFIED and are never shown publicly.
 * Re-verification procedure: docs/AFFORDABILITY-VERIFICATION.md
 */

const CHECKED = '2026-11-09';

const RESOURCES = [
  {
    id: 'medicare-help-with-drug-costs',
    name: 'Medicare: Help with drug costs (Extra Help)',
    operator: 'U.S. Centers for Medicare & Medicaid Services (Medicare.gov)',
    type: 'government',
    commercial: false,
    url: 'https://www.medicare.gov/basics/costs/help/drug-costs',
    geography: 'United States',
    summary: 'Official explanation of Extra Help, the Medicare programme that helps with Part D drug plan premiums, deductibles and other drug costs. It also points to state drug-cost help, manufacturer help and other ways to lower costs.',
    who_it_may_help: 'People with Medicare who have limited income and resources. The page says some people get Extra Help automatically (for example with full Medicaid, a Medicare Savings Program or Supplemental Security Income) and others must apply.',
    limitations: [
      'Income and resource limits change each year; the linked page has the current figures.',
      'The page says Extra Help is not available in Puerto Rico, the U.S. Virgin Islands, Guam, the Northern Mariana Islands or American Samoa, where other programmes may apply.',
      'Applications go through Social Security; the Social Security page itself could not be machine-checked and is not listed here.',
      'State pharmaceutical assistance programmes are reached from a link on this page and vary by state.'
    ],
    verified_at: CHECKED,
    evidence: {
      final_url: 'https://www.medicare.gov/basics/costs/help/drug-costs',
      http_status: 200,
      confirmed: [
        'Describes Extra Help as a Medicare programme for people with limited income and resources to pay Part D costs.',
        'States who qualifies automatically and that others can apply, with free help from a State Health Insurance Assistance Program.',
        'Lists other ways to lower drug costs, including checking for manufacturer help and whether the state offers help.',
        'States that discount cards used instead of the Medicare plan do not count toward the Medicare deductible or out-of-pocket maximum.',
        'Footer states the site is managed and paid for by the U.S. Centers for Medicare and Medicaid Services.'
      ]
    }
  },
  {
    id: 'healthcare-gov-lower-costs',
    name: 'HealthCare.gov: Saving money on health insurance',
    operator: 'U.S. federal government (HealthCare.gov)',
    type: 'government',
    commercial: false,
    url: 'https://www.healthcare.gov/lower-costs/',
    geography: 'United States',
    summary: 'Official screening page to check whether you might pay less for Marketplace health insurance or qualify for Medicaid or the Children\'s Health Insurance Program, based on household income.',
    who_it_may_help: 'People without affordable health coverage who want to see whether they may qualify for Marketplace savings, Medicaid or CHIP. Eligibility is set by the programme; check the linked page.',
    limitations: [
      'This is about health coverage, not the price of an individual medicine.',
      'The page gives an estimate; exact plan costs and savings come only from a Marketplace application.',
      'Enrolment periods and deadlines apply; the linked page has the current dates.',
      'The screening on that site asks about income and household. PharmacyNews does not see anything you enter there.'
    ],
    verified_at: CHECKED,
    evidence: {
      final_url: 'https://www.healthcare.gov/lower-costs/',
      http_status: 200,
      confirmed: [
        'Page offers a check for Marketplace premium savings and for Medicaid or CHIP qualification based on income.',
        'Explains how to estimate expected household income and who to include in a household.',
        'States exact plan prices and savings are provided when a Marketplace application is completed.',
        'Identifies itself as an official website of the United States government.'
      ]
    }
  },
  {
    id: 'medicaid-state-contacts',
    name: 'Medicaid.gov: Where can people get help with Medicaid and CHIP?',
    operator: 'U.S. federal government (Medicaid.gov)',
    type: 'government',
    commercial: false,
    url: 'https://www.medicaid.gov/about-us/where-can-people-get-help-medicaid-chip',
    geography: 'United States',
    summary: 'Official state-by-state list of Medicaid and CHIP agencies with links for eligibility and enrolment and a phone number for each state and territory.',
    who_it_may_help: 'Eligibility is set by the programme; check the linked page. Each state or territory agency decides who qualifies.',
    limitations: [
      'Medicaid and CHIP are run by states and territories, so rules, covered medicines and copayments differ by place.',
      'This page is a contact list; it does not decide eligibility.'
    ],
    verified_at: CHECKED,
    evidence: {
      final_url: 'https://www.medicaid.gov/about-us/where-can-people-get-help-medicaid-chip',
      http_status: 200,
      confirmed: [
        'Page lists states and territories with agency names, eligibility and enrolment links and phone numbers.',
        'Identifies itself as an official website of the United States government.'
      ]
    }
  },
  {
    id: 'fda-besaferx',
    name: 'FDA BeSafeRx: online pharmacy safety',
    operator: 'U.S. Food and Drug Administration',
    type: 'safety_guidance',
    commercial: false,
    url: 'https://www.fda.gov/drugs/buying-using-medicine-safely/besaferx-your-source-online-pharmacy-information',
    geography: 'United States',
    summary: 'FDA campaign pages on buying prescription medicine online safely, including the signs of a safe online pharmacy, warning signs of unsafe sites, and a way to look up a state-licensed online pharmacy.',
    who_it_may_help: 'Anyone thinking about buying prescription medicine from an online pharmacy.',
    limitations: [
      'This is safety guidance; it does not lower the cost of a medicine.',
      'The page shows a content date of September 2020, so details may have changed.',
      'The licence lookup is on a linked FDA page and relies on state licensing records.'
    ],
    verified_at: CHECKED,
    evidence: {
      final_url: 'https://www.fda.gov/drugs/buying-using-medicine-safely/besaferx-your-source-online-pharmacy-information',
      http_status: 200,
      confirmed: [
        'Describes BeSafeRx as an FDA campaign to help consumers learn how to buy prescription medicines online safely.',
        'Links to guidance on recognising safe and unsafe online pharmacies and to a state-licensed online pharmacy lookup.',
        'Explains how to report websites thought to be selling medicine illegally.',
        'Page shows content current as of 21 September 2020.',
        'The older quick-tips address redirected once to this page.'
      ]
    }
  },
  {
    id: 'phrma-americas-medicines',
    name: 'America\'s Medicines (PhRMA search tool; mat.org now redirects here)',
    operator: 'PhRMA (Pharmaceutical Research and Manufacturers of America), an industry association',
    type: 'nonprofit_directory',
    commercial: false,
    url: 'https://americasmedicines.com/',
    geography: 'United States',
    summary: 'A search tool run by the pharmaceutical industry association that looks up savings cards, patient support and direct purchase resources offered by medicine manufacturers for a named medicine.',
    who_it_may_help: 'Eligibility is set by the programme; check the linked page. Each manufacturer resource found through the search has its own rules.',
    limitations: [
      'Run by the pharmaceutical industry\'s own association and lists resources that industry offers; it is not an independent comparison.',
      'The page says it is a search engine, not a purchase programme or patient support programme itself.',
      'The former Medicine Assistance Tool address (mat.org) redirected here on the check date; the longer medicineassistancetool.org address did not respond.',
      'Programmes open, close and change their rules.'
    ],
    verified_at: CHECKED,
    evidence: {
      final_url: 'https://americasmedicines.com/',
      http_status: 200,
      confirmed: [
        'A request to mat.org redirected once to americasmedicines.com.',
        'Page describes the site as PhRMA\'s, helping patients, caregivers and providers find more affordable ways to purchase prescribed medicines.',
        'Page states it is not its own direct purchase or patient support programme but a search engine for resources the biopharmaceutical industry offers.',
        'Search begins by entering the medicines a person needs help accessing.'
      ]
    }
  },
  {
    id: 'healthwell-foundation',
    name: 'HealthWell Foundation',
    operator: 'HealthWell Foundation',
    type: 'charitable_foundation',
    commercial: false,
    url: 'https://www.healthwellfoundation.org/',
    geography: 'United States',
    summary: 'A foundation that helps people who have insurance but still cannot afford treatment, assisting with copays, premiums, deductibles and out-of-pocket costs through disease-specific funds.',
    who_it_may_help: 'The page says you may qualify if you have some form of health insurance, your disease and treatment are covered by one of its funds, your income is within its limit relative to the federal poverty level, and you are treated in the U.S. or U.S. territories.',
    limitations: [
      'Disease funds open and close; on the check date many funds were shown as closed. Availability changes, so check the fund list on the linked page.',
      'The page states you must have some form of health insurance, so it does not cover people with no insurance at all.',
      'The income limit is set by the foundation; the linked page has the current figure.'
    ],
    verified_at: CHECKED,
    evidence: {
      final_url: 'https://www.healthwellfoundation.org/',
      http_status: 200,
      confirmed: [
        'States it assists with copays, premiums, deductibles and out-of-pocket expenses when insurance is not enough.',
        'Lists qualifying steps: having insurance, a covered disease, a covered treatment, income within its poverty-level limit, and treatment in the U.S. or territories.',
        'Shows a disease fund list in which each fund is marked open or closed, with alerts available for closed funds.'
      ]
    }
  },
  {
    id: 'good-days',
    name: 'Good Days',
    operator: 'Good Days (Chronic Disease Fund, Inc.)',
    type: 'charitable_foundation',
    commercial: false,
    url: 'https://mygooddays.org/',
    geography: 'United States',
    summary: 'A charitable organisation that provides financial assistance for treatment costs to people with certain chronic illnesses, through a list of covered diseases.',
    who_it_may_help: 'Eligibility is set by the programme; check the linked page. The site has a covered-diseases list and a way to find out whether you qualify.',
    limitations: [
      'Help is limited to the diseases on its covered list, and funds open and close as money is available.',
      'Assistance is yearly; the site runs an annual re-enrolment.'
    ],
    verified_at: CHECKED,
    evidence: {
      final_url: 'https://mygooddays.org/',
      http_status: 200,
      confirmed: [
        'Describes itself as a charitable organisation helping with the burdens of chronic illness through assistance, advocacy and education.',
        'Footer states Good Days is an independent 501(c)(3) non-profit, Chronic Disease Fund, Inc. doing business as Good Days.',
        'Site offers pages for diseases covered, finding out if you qualify, applying, checking status and annual re-enrolment.',
        'The www address redirected once to mygooddays.org.'
      ]
    }
  },
  {
    id: 'nord-patient-assistance',
    name: 'NORD RareCare patient assistance programmes',
    operator: 'National Organization for Rare Disorders (NORD)',
    type: 'charitable_foundation',
    commercial: false,
    url: 'https://rarediseases.org/patient-assistance-programs/',
    geography: 'United States',
    summary: 'Financial assistance programmes for people living with rare diseases, which may help with medication, insurance premiums and copays, diagnostic testing and travel for specialist care or clinical trials.',
    who_it_may_help: 'People with a rare diagnosis that has a NORD programme. Eligibility is set by the programme; check the linked page, where you can search by diagnosis.',
    limitations: [
      'Only some rare diagnoses have a programme.',
      'Programmes open and close: the page lists statuses such as accepting applications, waitlist only and closed.'
    ],
    verified_at: CHECKED,
    evidence: {
      final_url: 'https://rarediseases.org/patient-assistance-programs/',
      http_status: 200,
      confirmed: [
        'States NORD has helped patients struggling to afford medications and care since 1987.',
        'Describes RareCare programmes as financial assistance for medication, insurance premiums and copays, diagnostic testing and travel.',
        'Provides a programme search by rare diagnosis with a status filter that includes closed and waitlist-only.',
        'Gives a patient services phone line.'
      ]
    }
  },
  {
    id: 'dispensary-of-hope',
    name: 'Dispensary of Hope',
    operator: 'Dispensary of Hope',
    type: 'charitable_foundation',
    commercial: false,
    url: 'https://www.dispensaryofhope.org/',
    geography: 'United States',
    summary: 'A charitable medication distributor that supplies medicine donated by manufacturers to participating pharmacies and safety-net clinics, which dispense it at no cost to eligible patients.',
    who_it_may_help: 'The site describes its purpose as serving people who are low income and uninsured. Eligibility is set by the programme; check the linked page.',
    limitations: [
      'Patients do not order from the organisation directly; medicine is obtained through a participating dispensing site, found with the site locator.',
      'What is available depends on donated supply and on whether a dispensing site is near you.'
    ],
    verified_at: CHECKED,
    evidence: {
      final_url: 'https://www.dispensaryofhope.org/',
      http_status: 200,
      confirmed: [
        'Describes itself as a charitable medication distributor giving pharmacies and safety-net clinics access to medicine donated by pharmaceutical manufacturers.',
        'States the medicine is distributed free of cost to people who are low income and uninsured.',
        'Offers a tool to find a dispensing site and a page of available medication.'
      ]
    }
  },
  {
    id: 'get-insulin',
    name: 'Get Insulin (GetInsulin.org)',
    operator: 'Beyond Type 1',
    type: 'nonprofit_directory',
    commercial: false,
    url: 'https://beyondtype1.org/get-insulin/',
    geography: 'United States',
    summary: 'A tool that points people with diabetes to insulin access and affordability options, with separate paths for an urgent need and for a continuing need. Available in English and Spanish.',
    who_it_may_help: 'People living with diabetes in the United States who need help affording insulin, whatever the brand. The page describes the urgent path as for people with less than seven days of insulin left.',
    limitations: [
      'It directs you to other programmes (such as manufacturer plans) and does not supply insulin itself.',
      'The tool on that site asks about location, insurance type, income and prescription. PharmacyNews does not see anything you enter there.',
      'The programmes it points to set their own rules and can change.'
    ],
    verified_at: CHECKED,
    evidence: {
      final_url: 'https://beyondtype1.org/get-insulin/',
      http_status: 200,
      confirmed: [
        'A request to getinsulin.org redirected once to this Beyond Type 1 page.',
        'Describes Get Insulin as connecting people with diabetes in the United States to insulin access and affordability options that match their circumstances.',
        'Offers an urgent insulin support path and a continuing-need path.',
        'States users answer questions such as location, insurance type, income and prescription and receive an action plan, in English and Spanish.'
      ]
    }
  },
  {
    id: 'lilly-insulin-value-program',
    name: 'Lilly Insulin Value Program',
    operator: 'Eli Lilly and Company',
    type: 'manufacturer_program',
    commercial: true,
    url: 'https://insulins.lilly.com/lilly-insulin-value-program',
    geography: 'United States',
    summary: 'The manufacturer\'s own page for its insulin savings card, which is downloaded and shown to the pharmacist to cap the monthly cost of Lilly insulins.',
    who_it_may_help: 'The page says it is for people prescribed a Lilly insulin who have commercial insurance or no insurance.',
    limitations: [
      'Covers Lilly insulins only.',
      'The page states that people enrolled in federal government insurance programmes are excluded from this card.',
      'Terms and conditions apply; the linked page has the current amount and rules.',
      'Manufacturer programmes can change or end.'
    ],
    verified_at: CHECKED,
    evidence: {
      final_url: 'https://insulins.lilly.com/lilly-insulin-value-program',
      http_status: 200,
      confirmed: [
        'A request to insulinaffordability.lilly.com redirected once to this page.',
        'Describes a savings card to download and present to the pharmacist for discounted Lilly insulin.',
        'States the programme applies with commercial insurance or no insurance and covers Lilly insulins.',
        'States government restrictions exclude people enrolled in federal government insurance programmes.',
        'Lists the covered insulin products and card terms and conditions.'
      ]
    }
  },
  {
    id: 'novo-nordisk-insulin-costs',
    name: 'NovoCare: Help with insulin costs',
    operator: 'Novo Nordisk',
    type: 'manufacturer_program',
    commercial: true,
    url: 'https://www.novocare.com/diabetes/help-with-costs/help-with-insulin-costs.html',
    geography: 'United States',
    summary: 'The manufacturer\'s own page listing its insulin affordability options: a monthly savings offer, savings cards, a patient assistance programme and a one-time short-term supply for urgent need.',
    who_it_may_help: 'The page groups options by situation: commercial insurance or no insurance for the monthly offer, commercial insurance for savings offers, no insurance or Medicare for the patient assistance programme, and people at risk of rationing for the immediate supply.',
    limitations: [
      'Covers Novo Nordisk products only.',
      'The page states eligibility and other restrictions apply to each option; the linked page has the current amounts and rules.',
      'The immediate supply is described as a one-time, short-term solution.',
      'Manufacturer programmes can change or end.'
    ],
    verified_at: CHECKED,
    evidence: {
      final_url: 'https://www.novocare.com/diabetes/help-with-costs/help-with-insulin-costs.html',
      http_status: 200,
      confirmed: [
        'Lists a monthly insulin offer for people with commercial insurance or no insurance.',
        'Lists savings offers for people with private or commercial insurance.',
        'Lists a Patient Assistance Program for people who are uninsured or have Medicare, which may provide medicine free of charge to those who qualify.',
        'Lists a one-time free short-term supply for people at risk of rationing insulin.',
        'Notes that eligibility and other restrictions apply.'
      ]
    }
  },
  {
    id: 'sanofi-patient-support',
    name: 'Sanofi patient support (Sanofi Patient Connection and insulin savings)',
    operator: 'Sanofi',
    type: 'manufacturer_program',
    commercial: true,
    url: 'https://www.sanofi.us/en/your-health/patient-support',
    geography: 'United States',
    summary: 'The manufacturer\'s own overview of its U.S. support programmes, including Sanofi Patient Connection, which provides medication at no cost to eligible patients, and a link to its insulin savings programme.',
    who_it_may_help: 'Eligibility is set by the programme; check the linked page. The page gives a phone line for support specialists who discuss individual situations.',
    limitations: [
      'Covers Sanofi products only.',
      'Insulin savings details are on a separate Sanofi site linked from this page, which was not itself checked.',
      'Manufacturer programmes can change or end.'
    ],
    verified_at: CHECKED,
    evidence: {
      final_url: 'https://www.sanofi.us/en/your-health/patient-support',
      http_status: 200,
      confirmed: [
        'Describes programmes intended to reduce out-of-pocket prescription costs.',
        'Describes Sanofi Patient Connection as a U.S. access and support programme providing medication at no cost to eligible patients and helping with insurance questions.',
        'Links to a Sanofi Insulin Savings Program and to product-specific support pages.',
        'Gives a phone number for live support specialists.'
      ]
    }
  },
  {
    id: 'goodrx',
    name: 'GoodRx',
    operator: 'GoodRx, Inc.',
    type: 'discount_tool',
    commercial: true,
    url: 'https://www.goodrx.com/',
    geography: 'United States',
    summary: 'A commercial website and app for comparing a prescription\'s discounted cash price across pharmacies and getting a coupon or discount card to show at the pharmacy.',
    who_it_may_help: 'Anyone with a prescription can search; the site does not describe eligibility rules for its basic coupons. Check the provider\'s terms.',
    limitations: [
      'This is a commercial service, not a charity or government programme, and the site states it is not insurance.',
      'Prices vary by pharmacy and by date, so compare the coupon price with your insurance price each time.',
      'Discount coupons are generally used instead of insurance, not with it. Medicare.gov states that discount-card purchases made outside a Medicare plan do not count toward the Medicare deductible or out-of-pocket maximum; for other plans, ask your insurer.',
      'The site also sells paid memberships, subscriptions and online care.',
      'Check the provider\'s terms and privacy policy before sharing information.'
    ],
    verified_at: CHECKED,
    evidence: {
      final_url: 'https://www.goodrx.com/',
      http_status: 200,
      confirmed: [
        'Describes searching for a medication, choosing dose and quantity, and comparing prices across pharmacies.',
        'Describes bringing a discount code or coupon to the pharmacy, and offers a prescription savings card.',
        'States that GoodRx is not insurance.',
        'Markets a paid membership, subscription plans and online care alongside the price search.',
        'Copyright notice names GoodRx, Inc.'
      ]
    }
  },
  {
    id: 'walmart-generic-prescription-program',
    name: 'Walmart low-cost Prescription Program (generic medicine list)',
    operator: 'Walmart',
    type: 'low_cost_pharmacy',
    commercial: true,
    url: 'https://www.walmart.com/cp/4-prescriptions/1078664',
    geography: 'United States',
    summary: 'A large retailer\'s published list of selected generic medicines sold at set low prices for 30-day and 90-day supplies at its pharmacies.',
    who_it_may_help: 'People prescribed a generic medicine that is on the retailer\'s list at a listed strength and quantity. Eligibility is set by the programme; check the linked page.',
    limitations: [
      'This is a commercial retailer, not a charity or government programme.',
      'Only selected generics at commonly prescribed doses and specified pack sizes are included.',
      'The page states prices may vary by state, may be limited to certain manufacturers of a medicine, and depend on stock at the dispensing pharmacy.',
      'The page says other restrictions may apply. Check the provider\'s terms and the current list with the pharmacy.'
    ],
    verified_at: CHECKED,
    evidence: {
      final_url: 'https://www.walmart.com/cp/4-prescriptions/1078664',
      http_status: 200,
      confirmed: [
        'Describes a low-cost Prescription Program giving access to select generic drugs at commonly prescribed dosages.',
        'Describes 30-day and 90-day supply options.',
        'States prices for some drugs may vary by state and that pricing may be limited to select manufacturers while in stock.',
        'Links to the full medication list in English and Spanish.'
      ]
    }
  },
  {
    id: 'united-way-211',
    name: '211',
    operator: 'United Way Worldwide',
    type: 'nonprofit_directory',
    commercial: false,
    url: 'https://211.org/',
    geography: 'United States',
    summary: 'A confidential phone and web referral service that connects people to local help, with categories that include healthcare expenses and paying bills.',
    who_it_may_help: 'Anyone looking for local assistance. Eligibility is set by each local programme; check the linked page or call.',
    limitations: [
      'A general referral service, not a medication programme; what it can refer you to depends on where you live.',
      'The site names corporate partners, including a commercial prescription discount company.'
    ],
    verified_at: CHECKED,
    evidence: {
      final_url: 'https://211.org/',
      http_status: 200,
      confirmed: [
        'States 211 connects callers to help and that every call is confidential.',
        'Help categories include healthcare expenses, paying bills, housing, utilities and food.',
        'Offers a way to find your local 211.',
        'Copyright notice names United Way Worldwide; partners named on the page include a prescription discount company.',
        'The www address redirected once to 211.org.'
      ]
    }
  },
  {
    id: 'nhs-prescription-prepayment-certificate',
    name: 'NHS prescription prepayment certificate (PPC)',
    operator: 'NHS',
    type: 'government',
    commercial: false,
    url: 'https://www.nhs.uk/nhs-services/prescriptions/save-money-with-a-prescription-prepayment-certificate-ppc/',
    geography: 'England',
    summary: 'Official NHS page on the prepayment certificate, which covers all your NHS prescriptions for a set period for one advance payment and may cost less if you need many items.',
    who_it_may_help: 'People who pay NHS prescription charges and expect to need several items. The page advises checking first whether you can get free prescriptions.',
    limitations: [
      'Applies to NHS prescription charges in England.',
      'The page says the certificate does not cover other health items such as wigs and fabric supports.',
      'Certificate options and charges change; the linked page has the current figures.',
      'The page shows its next content review as due on 27 November 2026, so details may change soon after this check.'
    ],
    verified_at: CHECKED,
    evidence: {
      final_url: 'https://www.nhs.uk/nhs-services/prescriptions/save-money-with-a-prescription-prepayment-certificate-ppc/',
      http_status: 200,
      confirmed: [
        'States a PPC covers all NHS prescriptions, including NHS dental prescriptions, however many items are needed.',
        'Describes three options: a 3-month certificate, a 12-month certificate and a hormone replacement therapy certificate.',
        'Advises checking for free prescription entitlement before applying, and explains applying online, by phone or at some pharmacies.',
        'Explains refunds, including using an NHS receipt while waiting for a certificate.',
        'Page shows last reviewed 27 November 2023 and next review due 27 November 2026.'
      ]
    }
  },
  {
    id: 'nhs-low-income-scheme',
    name: 'NHS Low Income Scheme (LIS)',
    operator: 'NHS',
    type: 'government',
    commercial: false,
    url: 'https://www.nhs.uk/nhs-services/help-with-health-costs/nhs-low-income-scheme-lis/',
    geography: 'England',
    summary: 'Official NHS page on the scheme that gives full or partial help with health costs, including prescription costs, to people on a low income.',
    who_it_may_help: 'People on a low income whose savings, investments or property are under the scheme\'s capital limit. The page says help also extends to a partner and dependent young people, and that some benefits already give full help without applying.',
    limitations: [
      'The capital limit and assessment rules are set by the scheme; the linked page has the current figures for England.',
      'Help can be full or partial depending on an assessment of income and outgoings.',
      'You must apply, online or by post, and certificates last for a limited time.'
    ],
    verified_at: CHECKED,
    evidence: {
      final_url: 'https://www.nhs.uk/nhs-services/help-with-health-costs/nhs-low-income-scheme-lis/',
      http_status: 200,
      confirmed: [
        'States the scheme covers prescription, dental, eyecare and healthcare travel costs, and wigs and fabric supports.',
        'States a capital limit applies and gives the limits for England.',
        'Describes full help (HC2 certificate) and partial help (HC3 certificate).',
        'Explains applying online through the NHS Business Services Authority or by post with an HC1 form, and gives a helpline.',
        'States people on certain income-related benefits already qualify for full help and need not apply.'
      ]
    }
  },
  {
    id: 'australia-pbs-safety-net',
    name: 'PBS Safety Net',
    operator: 'Australian Government (Pharmaceutical Benefits Scheme)',
    type: 'government',
    commercial: false,
    url: 'https://www.pbs.gov.au/healthpro/explanatory-notes/section1/Section_1_5_Explanatory_Notes',
    geography: 'Australia',
    summary: 'Official explanation of the Safety Net, under which a person or family who reaches a spending threshold on PBS medicines in a calendar year pays less, or nothing, for further PBS items that year.',
    who_it_may_help: 'People and families who need many PBS medicines in a year. The page defines the family as the person, their partner, children under 16 in their care and dependent full-time students under 25.',
    limitations: [
      'Written as explanatory notes for health professionals; the page links to consumer questions and answers.',
      'Thresholds are set each year and the count restarts each calendar year; the linked page has the current figures.',
      'The page states brand premiums and similar extra charges must still be paid.',
      'Supplies need to be recorded, on a record form or by the pharmacy\'s software, to count toward the threshold.'
    ],
    verified_at: CHECKED,
    evidence: {
      final_url: 'https://www.pbs.gov.au/healthpro/explanatory-notes/section1/Section_1_5_Explanatory_Notes',
      http_status: 200,
      confirmed: [
        'States the Safety Net protects patients and families who need a large number of PBS items.',
        'States that after the threshold is met in a calendar year, PBS items are supplied at a lower price or free for the rest of that year.',
        'Defines who counts as family for the scheme.',
        'Describes two thresholds, general and concessional, and the prescription record form used to track supplies.',
        'The address with an extra info path segment redirected once to this page.'
      ]
    }
  },
  {
    id: 'canada-prescription-drug-coverage',
    name: 'Prescription drugs in Canada: public and private drug plans',
    operator: 'Government of Canada (Health Canada)',
    type: 'government',
    commercial: false,
    url: 'https://www.canada.ca/en/health-canada/services/health-care-system/prescription-drugs.html',
    geography: 'Canada',
    summary: 'Official overview of drug coverage in Canada, explaining that each province and territory runs its own public drug plan, with a link to the list of provincial and territorial programmes.',
    who_it_may_help: 'The page says public plans are generally for those most in need based on age, income and medical condition, that provinces and territories have special coverage for very high drug costs, and that the federal government covers certain groups.',
    limitations: [
      'An overview only: who and what is covered is decided by each province or territory, on their own sites.',
      'Coverage agreements and programmes are changing; check the linked page and your provincial or territorial health ministry.'
    ],
    verified_at: CHECKED,
    evidence: {
      final_url: 'https://www.canada.ca/en/health-canada/services/health-care-system/prescription-drugs.html',
      http_status: 200,
      confirmed: [
        'States provinces and territories administer their own public drug plans and decide who and which drugs are covered and the patient share.',
        'States public plans are generally for those most in need based on age, income and medical condition.',
        'Links to the provincial and territorial public drug benefit programme list.',
        'Describes catastrophic drug coverage programmes for people with very high drug costs.',
        'Lists groups with federal drug coverage, such as First Nations and Inuit, and qualified veterans.',
        'An older address for this topic redirected once to this page.'
      ]
    }
  }
];

/*
 * Candidates that were NOT verified. Never rendered publicly.
 * The owner can check each by hand in a browser and move it into RESOURCES
 * with a full evidence block.
 */
const UNVERIFIED = [
  {
    id: 'ssa-extra-help',
    name: 'Social Security: Extra Help with Medicare prescription drug costs',
    candidate_url: 'https://www.ssa.gov/medicare/part-d-extra-help',
    http_status: 403,
    checked_at: CHECKED,
    reason: 'ssa.gov refused the automated request (HTTP 403). Extra Help is covered by the verified Medicare.gov entry, which links to this page.'
  },
  {
    id: 'hrsa-find-a-health-center',
    name: 'HRSA Find a Health Center',
    candidate_url: 'https://findahealthcenter.hrsa.gov/',
    http_status: 200,
    checked_at: CHECKED,
    reason: 'Returned HTTP 200 but only a script-loaded shell with no readable text, so no facts (sliding fee, 340B) could be confirmed. A second HRSA page (bphc.hrsa.gov, what is a health center) refused the request with HTTP 403.'
  },
  {
    id: 'needymeds',
    name: 'NeedyMeds',
    candidate_url: 'https://www.needymeds.org/',
    http_status: 200,
    checked_at: CHECKED,
    reason: 'Returned HTTP 200 but the home page and the /pap page are script-rendered with no readable text in the response, so nothing could be confirmed.'
  },
  {
    id: 'rxassist',
    name: 'RxAssist',
    candidate_url: 'https://www.rxassist.org/',
    http_status: 200,
    checked_at: CHECKED,
    reason: 'Page was read (patient assistance programme database). Held back for an owner decision: the footer names RxVantage as operator, the page does not say whether the service is nonprofit, and it promotes its own pharmacy savings card with a savings claim, so it does not fit a single type without a judgement call.'
  },
  {
    id: 'pan-foundation',
    name: 'PAN Foundation',
    candidate_url: 'https://www.panfoundation.org/',
    http_status: 403,
    checked_at: CHECKED,
    reason: 'Site refused the automated request (HTTP 403).'
  },
  {
    id: 'paf-copay-relief',
    name: 'Patient Advocate Foundation Co-Pay Relief',
    candidate_url: 'https://copays.org/',
    http_status: 403,
    checked_at: CHECKED,
    reason: 'copays.org redirected to totalassist.org, which refused the automated request (HTTP 403). The redirect to a different domain also needs a human check before any link is published.'
  },
  {
    id: 'nabp-buy-safely',
    name: 'NABP Safe Pharmacy: Buy Safely',
    candidate_url: 'https://safe.pharmacy/buy-safely/',
    http_status: 403,
    checked_at: CHECKED,
    reason: 'Site refused the automated request (HTTP 403).'
  },
  {
    id: 'singlecare',
    name: 'SingleCare',
    candidate_url: 'https://www.singlecare.com/',
    http_status: 403,
    checked_at: CHECKED,
    reason: 'Site refused the automated request (HTTP 403).'
  },
  {
    id: 'cost-plus-drugs',
    name: 'Mark Cuban Cost Plus Drug Company',
    candidate_url: 'https://costplusdrugs.com/',
    http_status: 403,
    checked_at: CHECKED,
    reason: 'Site refused the automated request (HTTP 403, bot-protection page).'
  }
];

module.exports = { RESOURCES, UNVERIFIED };
