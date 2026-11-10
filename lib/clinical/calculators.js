'use strict';
// Formula-only calculators. Each is a published equation with its primary citation, explicit
// units, input bounds and stated assumptions. They contain no drug-specific doses, rates or
// treatment recommendations. A calculator is offered to the public only after a
// credential-verified clinical reviewer has approved its exact version (see ../clinical-tools.js).
const round = (n, dp) => Math.round(n * 10 ** dp) / 10 ** dp;
class InputError extends Error { constructor(field, message) { super(message); this.field = field; this.code = 'INVALID_INPUT'; } }

// Parses and bounds-checks one numeric field. Empty, non-numeric or out-of-range values are
// errors; nothing is silently defaulted or clamped.
function number(values, f) {
  const raw = values?.[f.name];
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{1,4}(\.\d{1,3})?$/.test(text)) throw new InputError(f.name, `${f.label}: enter a number${f.unit ? ' in ' + f.unit : ''}`);
  const n = Number(text);
  if (n < f.min || n > f.max) throw new InputError(f.name, `${f.label}: must be between ${f.min} and ${f.max} ${f.unit || ''}`.trim());
  return n;
}
function choice(values, f) {
  const v = values?.[f.name];
  if (typeof v !== 'string' || !f.options.some(o => o.value === v)) throw new InputError(f.name, `${f.label}: choose an option`);
  return v;
}
function read(tool, values) {
  const out = {};
  for (const f of tool.inputs) out[f.name] = f.type === 'choice' ? choice(values, f) : number(values, f);
  return out;
}

// Turns a raw result into the displayed value. Results of 1 or more use `dp` decimals; smaller
// results use `smallDp` when given. A positive result that is below one display unit (and so
// would round to, or be indistinguishable from, zero) is refused: the tool must never show a
// zero or a misleadingly coarse figure for a non-zero input.
function display({ raw, dp, smallDp, label, unit }) {
  if (!Number.isFinite(raw) || raw < 0) throw new InputError(null, 'These inputs are outside the range the equation supports');
  const places = raw < 1 && Number.isInteger(smallDp) ? smallDp : dp, least = 10 ** -dp, value = round(raw, places);
  if (raw > 0 && (raw < least || value === 0)) throw new InputError(null, `${label}: the result is greater than zero but too small to display reliably (below ${least} ${unit}). Check the inputs and units.`);
  return { label, value, unit };
}

const SEX = { name: 'sex', label: 'Sex used by the equation', type: 'choice', options: [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }] };

const CALCULATORS = [
  {
    id: 'cockcroft-gault', version: '1.0.0', name: 'Creatinine clearance estimate (Cockcroft–Gault)',
    purpose: 'Estimates creatinine clearance in mL/min from age, weight, serum creatinine and sex.',
    population: 'Adults (18 years and over) with stable kidney function. The original study population was predominantly adult men.',
    formula: 'CrCl (mL/min) = (140 − age) × weight (kg) ÷ (72 × serum creatinine (mg/dL)); multiplied by 0.85 for female.',
    inputs: [
      { name: 'age', label: 'Age', unit: 'years', min: 18, max: 120 },
      { name: 'weight', label: 'Weight entered', unit: 'kg', min: 20, max: 400 },
      { name: 'scr', label: 'Serum creatinine', unit: 'mg/dL', min: 0.1, max: 20 },
      SEX
    ],
    assumptions: ['Uses the weight exactly as entered; which weight to use (actual, ideal or adjusted) is a clinical decision this tool does not make.', 'Serum creatinine must be in mg/dL (1 mg/dL = 88.4 µmol/L). No rounding-up of low creatinine values is applied.', 'Result is not normalised to body surface area.'],
    warnings: ['Not valid when kidney function is changing rapidly, in dialysis, in children, or in pregnancy.', 'An estimate only; it is not a measured clearance and is not a dosing recommendation.'],
    citations: [{ text: 'Cockcroft DW, Gault MH. Prediction of creatinine clearance from serum creatinine. Nephron. 1976;16(1):31-41.', url: 'https://pubmed.ncbi.nlm.nih.gov/1244564/' }],
    compute(v) { const x = (140 - v.age) * v.weight / (72 * v.scr) * (v.sex === 'female' ? 0.85 : 1); return [{ label: 'Estimated creatinine clearance', raw: x, dp: 1, unit: 'mL/min' }]; }
  },
  {
    id: 'ideal-body-weight-devine', version: '1.0.0', name: 'Ideal body weight (Devine)',
    purpose: 'Calculates ideal body weight in kg from height and sex.',
    population: 'Adults 152.4 cm (60 inches) or taller. The equation is not defined below 60 inches.',
    formula: 'IBW (kg) = 50 (male) or 45.5 (female) + 2.3 × (height in inches − 60).',
    inputs: [{ name: 'height', label: 'Height', unit: 'cm', min: 152.4, max: 250 }, SEX],
    assumptions: ['Height is converted with 1 inch = 2.54 cm.', 'No extrapolation is made for heights under 152.4 cm; such input is rejected.'],
    warnings: ['An empirical estimate; it is not a target weight and is not a dosing recommendation.'],
    citations: [{ text: 'Devine BJ. Gentamicin therapy. Drug Intell Clin Pharm. 1974;8:650-655.', url: null }, { text: 'Pai MP, Paloucek FP. The origin of the "ideal" body weight equations. Ann Pharmacother. 2000;34(9):1066-1069.', url: 'https://pubmed.ncbi.nlm.nih.gov/10981254/' }],
    compute(v) { const x = (v.sex === 'female' ? 45.5 : 50) + 2.3 * (v.height / 2.54 - 60); return [{ label: 'Ideal body weight', raw: x, dp: 1, unit: 'kg' }]; }
  },
  {
    id: 'bsa-mosteller', version: '1.0.0', name: 'Body surface area (Mosteller)',
    purpose: 'Calculates body surface area in m² from height and weight.',
    population: 'Adults and children; accuracy at extremes of body size is limited.',
    formula: 'BSA (m²) = √( height (cm) × weight (kg) ÷ 3600 ).',
    inputs: [{ name: 'height', label: 'Height', unit: 'cm', min: 30, max: 250 }, { name: 'weight', label: 'Weight', unit: 'kg', min: 1, max: 400 }],
    assumptions: ['Uses the height and weight exactly as entered.'],
    warnings: ['Other BSA equations give different results; use the equation your protocol specifies.', 'Not a dosing recommendation.'],
    citations: [{ text: 'Mosteller RD. Simplified calculation of body-surface area. N Engl J Med. 1987;317(17):1098.', url: 'https://pubmed.ncbi.nlm.nih.gov/3657876/' }],
    compute(v) { return [{ label: 'Body surface area', raw: Math.sqrt(v.height * v.weight / 3600), dp: 2, unit: 'm²' }]; }
  },
  {
    id: 'infusion-rate-conversion', version: '1.0.0', name: 'Weight-based infusion rate conversion (unit arithmetic)',
    purpose: 'Converts a prescribed dose in mcg/kg/min to a pump rate in mL/h for a stated concentration. Pure unit arithmetic: it contains no drug names, doses, concentrations or limits.',
    population: 'Any patient for whom a weight-based continuous infusion has already been prescribed and prepared.',
    formula: 'Rate (mL/h) = dose (mcg/kg/min) × weight (kg) × 60 ÷ concentration (mcg/mL).',
    inputs: [{ name: 'dose', label: 'Prescribed dose', unit: 'mcg/kg/min', min: 0.001, max: 1000 }, { name: 'weight', label: 'Dosing weight', unit: 'kg', min: 0.3, max: 400 }, { name: 'concentration', label: 'Final concentration', unit: 'mcg/mL', min: 0.1, max: 9999 }],
    assumptions: ['All three inputs come from the prescription and the prepared product label; the tool supplies none of them.', 'Concentration must be in mcg/mL (1 mg/mL = 1000 mcg/mL).'],
    warnings: ['Does not check whether a dose, concentration or rate is appropriate or within any limit.', 'Follow your institution\'s independent double-check policy; pump drug libraries take precedence.'],
    citations: [{ text: 'Dimensional analysis: (mcg/kg/min × kg × 60 min/h) ÷ (mcg/mL) = mL/h. No external dosing source is used.', url: null }],
    compute(v) { return [{ label: 'Pump rate', raw: v.dose * v.weight * 60 / v.concentration, dp: 2, smallDp: 3, unit: 'mL/h' }]; }
  }
];

function calculate(id, values) {
  const tool = CALCULATORS.find(c => c.id === id);
  if (!tool) throw Object.assign(new Error('Unknown calculator'), { code: 'UNKNOWN_TOOL' });
  const inputs = read(tool, values);
  return { inputs, results: tool.compute(inputs).map(display) };
}

module.exports = { CALCULATORS, calculate, display, InputError };
