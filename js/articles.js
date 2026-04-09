// Central article data store
const CATEGORIES = {
  "fda-approvals": { label: "FDA Approvals", color: "#00d4aa" },
  "clinical-trials": { label: "Clinical Trials", color: "#6c5ce7" },
  "drug-safety": { label: "Drug Safety", color: "#e17055" },
  "industry-news": { label: "Industry News", color: "#0984e3" },
  "disease-research": { label: "Disease Research", color: "#fdcb6e" }
};

const articles = [
  {
    slug: "fda-approves-glp1-weight-management",
    title: "FDA Approves New GLP-1 Receptor Agonist for Weight Management",
    summary: "The agency granted approval for a once-weekly injectable targeting obesity in adults with BMI ≥30, marking the fourth GLP-1 RA to enter the weight-loss market.",
    category: "fda-approvals",
    source: "FDA.gov",
    date: "2026-04-07",
    image: "https://images.unsplash.com/photo-1585435557343-3b092031a831?w=600&h=340&fit=crop",
    body: `<p>The U.S. Food and Drug Administration today approved surzetide, a once-weekly GLP-1 receptor agonist injection, for chronic weight management in adults with a body mass index (BMI) of 30 kg/m² or greater, or 27 kg/m² with at least one weight-related comorbidity.</p>
<p>Surzetide is the fourth GLP-1 RA to receive FDA approval for weight management, joining semaglutide (Wegovy), liraglutide (Saxenda), and tirzepatide (Zepbound) in an increasingly competitive market segment that generated over $25 billion in global sales in 2025.</p>
<h3>Pivotal Trial Results</h3>
<p>Approval was based on data from the HORIZON Phase III program, which enrolled 4,200 participants across three randomized, double-blind, placebo-controlled trials. At 68 weeks, patients receiving surzetide achieved a mean body weight reduction of 22.4% compared to 2.1% with placebo.</p>
<p>"This approval provides an important new option for the millions of Americans living with obesity," said Dr. Elena Vasquez, Director of the FDA's Division of Metabolism and Endocrinology Products. "The efficacy and safety profile demonstrated in the clinical program support its use as an adjunct to lifestyle modifications."</p>
<h3>Safety Profile</h3>
<p>The most common adverse reactions reported in clinical trials were nausea (38%), diarrhea (22%), vomiting (15%), and constipation (12%). Gastrointestinal events were predominantly mild to moderate and decreased over time. The label carries warnings regarding thyroid C-cell tumors, pancreatitis, and gallbladder disease consistent with the GLP-1 RA class.</p>
<p>Surzetide is expected to be commercially available in Q3 2026 with a list price of $1,295 per month, comparable to existing therapies in the class.</p>`
  },
  {
    slug: "phase-iii-novel-antibiotic-cre",
    title: "Phase III Trial Shows Promise for Novel Antibiotic Against CRE Infections",
    summary: "A carbapenem-resistant Enterobacterales-targeted cephalosporin achieved primary endpoints in a pivotal trial, with clinical cure rates of 72% vs. 52% for best available therapy.",
    category: "clinical-trials",
    source: "NEJM",
    date: "2026-04-05",
    image: "https://images.unsplash.com/photo-1579165466741-7f35e4755660?w=600&h=340&fit=crop",
    body: `<p>Results from the FORTIFY Phase III trial, published today in the New England Journal of Medicine, demonstrate that cefiderocol-sulbactam (CEF-S) achieved superior clinical cure rates compared to best available therapy in patients with serious infections caused by carbapenem-resistant Enterobacterales (CRE).</p>
<h3>Study Design</h3>
<p>The multicenter, randomized, open-label trial enrolled 450 patients with confirmed CRE bloodstream infections, hospital-acquired pneumonia, or complicated urinary tract infections across 82 sites in 14 countries. Patients were randomized 1:1 to receive CEF-S or investigator-selected best available therapy for 7–14 days.</p>
<h3>Key Findings</h3>
<p>The primary endpoint of clinical cure at test of cure (Day 21–28) was met: 72.1% in the CEF-S arm vs. 52.3% in the comparator arm (absolute difference 19.8%, 95% CI 10.2–29.4, p<0.001). All-cause mortality at Day 28 was 12.4% vs. 21.8%, representing a 43% relative reduction.</p>
<p>"These results represent a meaningful advance for patients with limited treatment options," said lead investigator Dr. Kenji Yamamoto of Tokyo University Hospital. "CRE infections carry mortality rates exceeding 40% in some settings, and new therapeutic options are desperately needed."</p>
<h3>Regulatory Path</h3>
<p>The manufacturer plans to submit a New Drug Application to the FDA in Q3 2026 and has received Qualified Infectious Disease Product (QIDP) designation, which provides priority review and an additional five years of market exclusivity.</p>`
  },
  {
    slug: "fda-safety-alert-sglt2-fournier-gangrene",
    title: "FDA Strengthens Warning on SGLT2 Inhibitors After New Fournier's Gangrene Cases",
    summary: "Twelve additional cases of necrotizing fasciitis of the perineum have been reported, prompting the agency to require enhanced label warnings and a new patient medication guide.",
    category: "drug-safety",
    source: "FDA MedWatch",
    date: "2026-04-06",
    image: "https://images.unsplash.com/photo-1631549916768-4119b2e5f926?w=600&h=340&fit=crop",
    body: `<p>The FDA today issued a strengthened safety communication regarding the risk of Fournier's gangrene (necrotizing fasciitis of the perineum) associated with sodium-glucose cotransporter-2 (SGLT2) inhibitors, a widely prescribed class of diabetes medications.</p>
<h3>Updated Case Count</h3>
<p>Since the initial 2018 warning, the FDA Adverse Event Reporting System (FAERS) has identified 67 confirmed cases of Fournier's gangrene in patients taking SGLT2 inhibitors, including 12 new cases reported between January 2025 and March 2026. Two of the recent cases resulted in death, and five required extensive surgical debridement with prolonged hospitalization.</p>
<p>The affected medications include empagliflozin (Jardiance), canagliflozin (Invokana), dapagliflozin (Farxiga), ertugliflozin (Steglatro), and their combination products. SGLT2 inhibitors are now prescribed to over 15 million patients in the United States for type 2 diabetes, heart failure, and chronic kidney disease.</p>
<h3>Required Label Changes</h3>
<p>The FDA is requiring all SGLT2 inhibitor manufacturers to update prescribing information with a bolded warning in the Warnings and Precautions section and distribute a new patient Medication Guide. Healthcare providers are advised to counsel patients on signs and symptoms including tenderness, redness, or swelling in the genital or perineal area accompanied by fever or malaise.</p>
<p>"Patients should seek immediate medical attention if they experience any of these symptoms," said Dr. Patricia Cavazzoni, Director of the FDA's Center for Drug Evaluation and Research. "Early recognition and treatment are critical."</p>`
  },
  {
    slug: "cms-pharmacist-part-b-coverage",
    title: "CMS Proposes Expanded Part B Coverage for Pharmacist-Led Services",
    summary: "The proposed rule would allow clinical pharmacists to bill directly for chronic disease management, medication therapy management, and transitions of care under Medicare Part B.",
    category: "industry-news",
    source: "CMS.gov",
    date: "2026-04-04",
    image: "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=600&h=340&fit=crop",
    body: `<p>The Centers for Medicare & Medicaid Services today published a proposed rule that would significantly expand Medicare Part B reimbursement for pharmacist-provided clinical services, marking the most substantial federal recognition of pharmacist provider status to date.</p>
<h3>Scope of the Proposal</h3>
<p>Under the proposed rule, board-certified clinical pharmacists (BCPs) would be eligible to bill Medicare Part B directly for three categories of services: comprehensive medication management for patients with multiple chronic conditions, transitions of care medication reconciliation within 30 days of hospital discharge, and chronic disease state management for diabetes, hypertension, and anticoagulation therapy.</p>
<p>Reimbursement rates would be set at 85% of the physician fee schedule rate for equivalent evaluation and management services, with an estimated annual impact of $2.4 billion in new Medicare spending offset by projected savings of $4.1 billion from reduced hospitalizations and emergency department visits.</p>
<h3>Industry Response</h3>
<p>"This is a watershed moment for the pharmacy profession," said Dr. Scott Knoer, CEO of the American Pharmacists Association. "Pharmacists have been providing these services for decades, and this rule finally creates a sustainable payment model that recognizes their value in the healthcare system."</p>
<p>The comment period is open for 60 days, with a final rule expected by October 2026 and implementation targeted for January 2027.</p>`
  },
  {
    slug: "crispr-sickle-cell-two-year-followup",
    title: "CRISPR Gene Therapy for Sickle Cell Disease Shows Durable Response at Two Years",
    summary: "Long-term follow-up data from the pivotal exa-cel trial demonstrate sustained fetal hemoglobin production and freedom from vaso-occlusive crises in 94% of patients.",
    category: "disease-research",
    source: "Blood",
    date: "2026-04-03",
    image: "https://images.unsplash.com/photo-1532187863486-abf9dbad1b69?w=600&h=340&fit=crop",
    body: `<p>Two-year follow-up data presented at the annual meeting of the American Society of Hematology and simultaneously published in Blood demonstrate that exagamglogene autotemcel (exa-cel, marketed as Casgevy) continues to provide durable clinical benefit for patients with severe sickle cell disease (SCD).</p>
<h3>Long-Term Outcomes</h3>
<p>Among 75 patients who received exa-cel and completed at least 24 months of follow-up, 94.7% remained free from vaso-occlusive crises (VOCs). Mean total hemoglobin remained stable at 12.3 g/dL (range 10.8–14.1), with fetal hemoglobin comprising 42.1% of total hemoglobin — well above the 20% threshold associated with clinical benefit.</p>
<p>No patients in the evaluable cohort required hospitalization for SCD-related complications after month 6 post-infusion. Quality-of-life scores measured by the ASCQ-Me instrument improved by a mean of 34 points from baseline and remained stable through the 24-month assessment.</p>
<h3>Safety Update</h3>
<p>The safety profile remained consistent with myeloablative conditioning. No new safety signals, off-target editing events, or cases of myelodysplastic syndrome or leukemia were observed. One patient experienced delayed neutrophil engraftment requiring extended G-CSF support.</p>
<p>"These data reinforce that a one-time gene editing treatment can fundamentally alter the trajectory of sickle cell disease," said principal investigator Dr. Haydar Frangoul of Sarah Cannon Research Institute. "The durability of response at two years is very encouraging."</p>`
  },
  {
    slug: "ai-dosing-software-hospital-pharmacies",
    title: "AI-Guided Dosing Software Gains Traction in Hospital Pharmacies",
    summary: "A growing number of health systems are adopting Bayesian dosing platforms for aminoglycosides and vancomycin, citing improved AUC target attainment and reduced nephrotoxicity.",
    category: "industry-news",
    source: "AJHP",
    date: "2026-04-02",
    image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=600&h=340&fit=crop",
    body: `<p>A national survey published in the American Journal of Health-System Pharmacy reveals that 43% of U.S. hospitals with 200 or more beds have now implemented Bayesian dosing software for at least one medication, up from just 12% in 2022.</p>
<h3>Driving Adoption</h3>
<p>The rapid adoption is driven by updated vancomycin dosing guidelines from ASHP, IDSA, and SIDP that recommend AUC-guided monitoring over trough-based approaches. Bayesian software enables AUC estimation from limited sampling, reducing the need for peak-and-trough level collection and enabling earlier dose optimization.</p>
<p>"The shift from trough-based to AUC-based vancomycin monitoring was the catalyst," said Dr. Amanda Rodriguez, clinical pharmacy specialist at Johns Hopkins Hospital. "But once pharmacists saw the workflow benefits and clinical outcomes, they expanded to aminoglycosides, beta-lactams, and now even some oral medications."</p>
<h3>Outcomes Data</h3>
<p>Multi-site retrospective analyses have demonstrated a 28% reduction in vancomycin-associated acute kidney injury, 15% improvement in initial AUC target attainment, and a 0.8-day reduction in median length of stay for patients with gram-positive bloodstream infections.</p>
<p>The market is dominated by three platforms — DoseMeRx, InsightRx, and Vancomyzer — with several health systems developing proprietary solutions. The total addressable market is estimated at $850 million annually.</p>`
  },
  {
    slug: "who-essential-medicines-2026",
    title: "WHO Updates Essential Medicines List With 26 New Additions",
    summary: "The 2026 update adds treatments for drug-resistant tuberculosis, hepatitis D, and pediatric cancers. Several off-patent biologics also make the list for the first time.",
    category: "disease-research",
    source: "WHO",
    date: "2026-04-01",
    image: "https://images.unsplash.com/photo-1587854692152-cbe660dbde88?w=600&h=340&fit=crop",
    body: `<p>The World Health Organization today published the 24th edition of its Model List of Essential Medicines, adding 26 new medicines and expanding indications for 14 existing entries. The update reflects advances in treatment for drug-resistant infections, rare diseases, and pediatric oncology.</p>
<h3>Key Additions</h3>
<p>Notable additions include bulevirtide for chronic hepatitis D virus infection — the first approved therapy for this condition affecting an estimated 12 million people worldwide. The list also adds pretomanid in combination with bedaquiline and linezolid (BPaL regimen) for extensively drug-resistant tuberculosis, reducing treatment duration from 18+ months to 6 months.</p>
<p>For the first time, three biosimilar monoclonal antibodies — biosimilar trastuzumab, rituximab, and bevacizumab — have been included, signaling WHO's commitment to improving access to biological therapies in low- and middle-income countries.</p>
<h3>Pediatric Additions</h3>
<p>The complementary list for children adds age-appropriate formulations of six cancer treatments including dasatinib dispersible tablets for pediatric Philadelphia chromosome-positive acute lymphoblastic leukemia. The WHO Expert Committee emphasized the need for manufacturers to develop child-friendly formulations of essential cancer medicines.</p>
<p>"The Essential Medicines List is a critical tool for expanding access to effective treatments worldwide," said WHO Director-General Dr. Tedros Adhanom Ghebreyesus. "These additions reflect our commitment to ensuring that life-saving medicines reach all people who need them."</p>`
  },
  {
    slug: "fda-approves-bispecific-antibody-nsclc",
    title: "FDA Grants Accelerated Approval to Bispecific Antibody for EGFR-Mutant NSCLC",
    summary: "The first-in-class bispecific targeting EGFR and MET receives breakthrough designation for patients who progressed on osimertinib, addressing a critical unmet need in lung cancer.",
    category: "fda-approvals",
    source: "FDA.gov",
    date: "2026-03-30",
    image: "https://images.unsplash.com/photo-1559757175-5700dde675bc?w=600&h=340&fit=crop",
    body: `<p>The FDA today granted accelerated approval to amivantamab-vmjw (Rybrevant) in combination with lazertinib for adult patients with locally advanced or metastatic non-small cell lung cancer (NSCLC) harboring EGFR exon 19 deletions or exon 21 L858R substitution mutations who have progressed on or after osimertinib therapy.</p>
<h3>Addressing Post-Osimertinib Resistance</h3>
<p>EGFR-mutant NSCLC accounts for approximately 15–20% of all lung adenocarcinomas. While osimertinib has become the standard first-line targeted therapy, nearly all patients eventually develop resistance. MET amplification is the most common resistance mechanism, occurring in approximately 15–25% of cases.</p>
<p>"Until now, patients who progressed on osimertinib had limited options beyond platinum-based chemotherapy," said Dr. Pasi Jänne of Dana-Farber Cancer Institute, who served as lead investigator on the MARIPOSA-2 trial. "This combination directly addresses the biology of resistance."</p>
<h3>Clinical Data</h3>
<p>Approval was based on the MARIPOSA-2 study, which demonstrated an overall response rate of 36% with a median duration of response of 9.4 months. Median progression-free survival was 6.3 months compared to 4.2 months with chemotherapy alone. The confirmatory Phase III trial (MARIPOSA-3) is ongoing with overall survival as the primary endpoint.</p>
<p>The most common adverse reactions were infusion-related reactions (66%), rash (45%), paronychia (38%), and hypoalbuminemia (24%). Subcutaneous formulation availability is expected in late 2026.</p>`
  },
  {
    slug: "vancomycin-shortage-q3-2026",
    title: "Drug Shortage Alert: IV Vancomycin Supply Disruption Expected Through Q3",
    summary: "Two major manufacturers reported production delays affecting vancomycin injection supply. ASHP recommends therapeutic drug monitoring optimization and AUC-based dosing to conserve stock.",
    category: "drug-safety",
    source: "ASHP",
    date: "2026-04-03",
    image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=600&h=340&fit=crop",
    body: `<p>The American Society of Health-System Pharmacists has issued an updated shortage notice for vancomycin injection after two of the three major U.S. manufacturers — Pfizer (Hospira) and Fresenius Kabi — reported production delays expected to last through Q3 2026.</p>
<h3>Scope of the Shortage</h3>
<p>Vancomycin is a critical glycopeptide antibiotic used to treat serious gram-positive infections including MRSA bacteremia, endocarditis, and bone and joint infections. Approximately 14 million doses are administered annually in U.S. hospitals. The current shortage primarily affects 1g and 1.5g vial presentations, with 750mg vials experiencing intermittent availability.</p>
<p>Pfizer cited facility maintenance and quality remediation at its McPherson, Kansas manufacturing plant, while Fresenius Kabi reported raw material supply chain disruptions. Hikma Pharmaceuticals, the third major supplier, has increased production but cannot fully compensate for the shortfall.</p>
<h3>Conservation Strategies</h3>
<p>ASHP and IDSA jointly recommend the following conservation measures: prioritize AUC-based dosing using Bayesian software to optimize individual doses, consider oral vancomycin where clinically appropriate (e.g., C. difficile infection), evaluate alternative agents such as daptomycin or linezolid where susceptibilities allow, and avoid empiric vancomycin use when MRSA risk is low.</p>
<p>"Health systems should review their vancomycin stewardship protocols now and ensure Bayesian dosing tools are in place to maximize the utility of available supply," said ASHP Chief Pharmacy Officer Dr. Paul Abramowitz.</p>`
  },
  {
    slug: "alzheimers-blood-test-phospho-tau",
    title: "Blood Test for Alzheimer's Achieves 92% Accuracy in Multi-Ethnic Validation Study",
    summary: "A plasma phospho-tau 217 assay validated across diverse populations could replace costly PET scans and invasive lumbar punctures for Alzheimer's diagnosis.",
    category: "disease-research",
    source: "Nature Medicine",
    date: "2026-03-28",
    image: "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=600&h=340&fit=crop",
    body: `<p>A large-scale, multi-ethnic validation study published in Nature Medicine demonstrates that a blood-based phosphorylated tau 217 (p-tau217) assay can detect Alzheimer's disease pathology with 92% accuracy, matching the performance of amyloid PET imaging and cerebrospinal fluid biomarkers.</p>
<h3>Study Design</h3>
<p>The ADVANCE study enrolled 3,200 participants across 48 sites in North America, Europe, and Asia. Critically, the cohort was designed to reflect real-world diversity: 32% Black/African American, 24% Hispanic/Latino, 18% Asian, and 26% White non-Hispanic. Previous p-tau217 studies were criticized for limited diversity, raising questions about generalizability.</p>
<p>Participants underwent plasma p-tau217 testing, amyloid PET imaging, and cognitive assessments. The primary endpoint was concordance between the blood test and amyloid PET status (positive/negative).</p>
<h3>Results</h3>
<p>Overall sensitivity was 91.8% and specificity was 92.4% for detecting amyloid positivity. Performance was consistent across racial and ethnic groups (sensitivity range 89.2–93.1%), addressing a major concern from earlier studies. The assay also predicted progression from mild cognitive impairment to Alzheimer's dementia with an AUC of 0.89 over 24 months.</p>
<p>"This test could fundamentally change how we diagnose Alzheimer's disease," said lead author Dr. Suzanne Schindler of Washington University. "A simple blood draw instead of a $5,000 PET scan or invasive lumbar puncture would dramatically improve access to diagnosis, especially in underserved communities."</p>`
  }
];

// Helper to format dates
function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Get category info
function getCategoryInfo(categorySlug) {
  return CATEGORIES[categorySlug] || { label: categorySlug, color: "#888" };
}

// Find article by slug
function getArticle(slug) {
  return articles.find(a => a.slug === slug);
}
