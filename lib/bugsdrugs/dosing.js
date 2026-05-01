// Pure-function dosing helpers for Bugs & Drugs.
// All inputs validated before reaching here; numeric assumptions documented.

function devineIBW(heightCm, sex) {
  const heightInches = heightCm / 2.54;
  const over60 = Math.max(0, heightInches - 60);
  return sex === 'female' ? 45.5 + 2.3 * over60 : 50 + 2.3 * over60;
}

// Adjusted body weight for aminoglycoside-style dosing in obese patients
function adjustedBW(actualKg, ibwKg) {
  if (actualKg <= ibwKg) return actualKg;
  return ibwKg + 0.4 * (actualKg - ibwKg);
}

// Cockcroft-Gault, mL/min. Inputs: age (years), weight (kg), scr (mg/dL), sex.
// IDSA/FDA labels still use CG (not CKD-EPI) for renal antibiotic dosing.
function cockcroftGault({ age, weightKg, scr, sex, capAt120 = false }) {
  const sexFactor = sex === 'female' ? 0.85 : 1;
  const num = (140 - age) * weightKg * sexFactor;
  const denom = 72 * scr;
  const crcl = num / denom;
  if (capAt120 && crcl > 120) return 120;
  return crcl;
}

// Schwartz pediatric CrCl, mL/min/1.73m². Bedside Schwartz constant 0.413
// (creatinine assays standardized post-2009).
function schwartzCrCl({ heightCm, scr }) {
  return (0.413 * heightCm) / scr;
}

// Pick the row from a renal_adjustment array whose CrCl band the patient falls into.
function pickRenalRow(rows, crcl) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows.find(r => crcl >= r.crcl_min && crcl <= r.crcl_max) || rows[rows.length - 1];
}

function dosingWeight(drug, { weightKg, heightCm, sex }) {
  const basis = (drug.weight_basis || 'tbw').toLowerCase();
  const ibw = devineIBW(heightCm, sex);
  if (basis === 'tbw' || basis === 'actual') return { weight: weightKg, basis: 'Actual (TBW)' };
  if (basis === 'ibw') return { weight: ibw, basis: `IBW ${ibw.toFixed(1)} kg (Devine)` };
  if (basis === 'adjbw') {
    const adj = adjustedBW(weightKg, ibw);
    return { weight: adj, basis: `AdjBW ${adj.toFixed(1)} kg (IBW ${ibw.toFixed(1)} + 0.4×excess)` };
  }
  if (basis === 'fixed') return { weight: null, basis: 'Fixed dose (not weight-based)' };
  return { weight: weightKg, basis: 'Actual (TBW)' };
}

function pediatricDose(drug, { weightKg, heightCm, ageYears }) {
  const p = drug.pediatric || {};
  const lines = [];
  if (p.notes && /not.*approved/i.test(p.notes)) {
    return { lines: [`Pediatric use not FDA-approved: ${p.notes}`], unsafe: true };
  }
  if (p.min_age_year && ageYears < p.min_age_year) {
    lines.push(`Caution: minimum age per label is ${p.min_age_year} years.`);
  }
  if (p.min_age_months && ageYears * 12 < p.min_age_months) {
    lines.push(`Caution: minimum age per label is ${p.min_age_months} months.`);
  }
  if (p.min_weight_kg && weightKg < p.min_weight_kg) {
    lines.push(`Caution: minimum weight per label is ${p.min_weight_kg} kg.`);
  }

  if (p.weight_kg_dose) {
    let band = null;
    for (const row of p.weight_kg_dose) {
      const okMin = row.kg_min == null || weightKg >= row.kg_min;
      const okMax = row.kg_max == null || weightKg <= row.kg_max;
      if (okMin && okMax) { band = row; break; }
    }
    if (band) lines.push(`Weight-band dose: ${band.dose}`);
    return { lines };
  }

  if (p.mg_per_kg_per_dose) {
    const perDose = p.mg_per_kg_per_dose * weightKg;
    const capped = p.max_per_dose_mg ? Math.min(perDose, p.max_per_dose_mg) : perDose;
    lines.push(`Per dose: ${capped.toFixed(0)} mg ${p.frequency || ''} (${p.mg_per_kg_per_dose} mg/kg × ${weightKg.toFixed(1)} kg${p.max_per_dose_mg ? `, capped at ${p.max_per_dose_mg} mg` : ''})`);
  } else if (p.mg_per_kg_per_day) {
    const perDay = p.mg_per_kg_per_day * weightKg;
    const capped = p.max_per_day_mg ? Math.min(perDay, p.max_per_day_mg) : perDay;
    lines.push(`Total daily: ${capped.toFixed(0)} mg/day (${p.mg_per_kg_per_day} mg/kg/day${p.max_per_day_mg ? `, capped at ${p.max_per_day_mg} mg/day` : ''})`);
  } else if (p.units_per_kg_per_dose) {
    const perDose = p.units_per_kg_per_dose * weightKg;
    lines.push(`Per dose: ${Math.round(perDose).toLocaleString()} units ${p.frequency || ''}`);
  } else if (p.dose) {
    lines.push(p.dose);
  } else {
    lines.push('No structured peds dose available; refer to label.');
  }

  if (p.notes) lines.push(`Note: ${p.notes}`);
  return { lines };
}

function calculate(drug, patient) {
  const { age, weightKg, heightCm, scr, sex } = patient;
  const ageYears = age;
  const isPediatric = ageYears < 18;
  const out = {
    drug: drug.generic,
    drug_slug: drug.slug,
    is_pediatric: isPediatric,
    inputs: { ...patient },
    crcl: null,
    crcl_basis: null,
    weight_used: null,
    weight_basis: null,
    recommendation: [],
    renal_rule: null,
    notes: [],
    cautions: [],
    sources: { label: drug.label_url || null }
  };

  if (drug.vancomyzer) {
    out.cautions.push('Vancomycin should be dosed by AUC-targeted Bayesian estimation. Use vancomyzer.com — this calculator only displays nominal/empiric ranges.');
  }

  if (isPediatric) {
    const peds = pediatricDose(drug, { weightKg, heightCm, ageYears });
    if (peds.unsafe) {
      out.recommendation = peds.lines;
      out.cautions.push('Drug not labeled for pediatric use.');
      return out;
    }
    out.recommendation.push(...peds.lines);

    if (heightCm && scr) {
      const crcl = schwartzCrCl({ heightCm, scr });
      out.crcl = Math.round(crcl);
      out.crcl_basis = `Bedside Schwartz: 0.413 × height(cm) / SCr = 0.413 × ${heightCm} / ${scr} = ${out.crcl} mL/min/1.73m²`;
      const row = pickRenalRow(drug.renal, crcl);
      if (row) {
        out.renal_rule = `CrCl ${row.crcl_min}–${row.crcl_max} mL/min: ${row.dose}`;
      }
    }
    if (drug.hepatic) out.notes.push(`Hepatic: ${drug.hepatic}`);
    if (drug.notes) out.notes.push(drug.notes);
    return out;
  }

  // Adult flow
  const dw = dosingWeight(drug, { weightKg, heightCm, sex });
  out.weight_used = dw.weight ? Number(dw.weight.toFixed(1)) : null;
  out.weight_basis = dw.basis;

  // CG uses actual weight unless drug calls for IBW (e.g., aminoglycoside CrCl uses TBW for CG itself,
  // but dosing weight switches to AdjBW separately). Convention: use actual for CG.
  const crcl = cockcroftGault({ age: ageYears, weightKg, scr, sex });
  out.crcl = Math.round(crcl);
  const sexFactor = sex === 'female' ? 0.85 : 1;
  out.crcl_basis = `Cockcroft-Gault: ((140 − ${ageYears}) × ${weightKg} × ${sexFactor}) / (72 × ${scr}) = ${out.crcl} mL/min`;

  // Adult default dose
  if (drug.adult && drug.adult.default) {
    out.recommendation.push(`Standard adult dose: ${drug.adult.default}`);
  }
  if (drug.adult && drug.adult.high_dose) {
    out.recommendation.push(`High-dose option: ${drug.adult.high_dose}`);
  }

  // Renal adjustment
  if (Array.isArray(drug.renal) && drug.renal.length > 0) {
    const row = pickRenalRow(drug.renal, crcl);
    if (row) {
      out.renal_rule = `CrCl ${row.crcl_min}–${row.crcl_max} mL/min: ${row.dose}`;
    }
  } else {
    out.notes.push('No renal dose adjustment specified for this agent.');
  }

  // Weight-based caveat
  if (dw.weight !== null && (drug.weight_basis === 'actual' || drug.weight_basis === 'tbw' || drug.weight_basis === 'adjbw' || drug.weight_basis === 'ibw')) {
    out.notes.push(`Dosing weight: ${dw.basis}.`);
  }

  if (drug.hepatic) out.notes.push(`Hepatic: ${drug.hepatic}`);
  if (drug.pregnancy) out.notes.push(`Pregnancy: ${drug.pregnancy}`);
  if (drug.notes) out.notes.push(drug.notes);

  return out;
}

function validatePatient(p) {
  const errors = [];
  const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
  const age = num(p.age);
  const weightKg = num(p.weightKg);
  const heightCm = num(p.heightCm);
  const scr = num(p.scr);
  const sex = String(p.sex || '').toLowerCase();

  if (!Number.isFinite(age) || age < 0 || age > 120) errors.push('Age must be 0–120 years.');
  if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 400) errors.push('Weight must be 0–400 kg.');
  if (!Number.isFinite(heightCm) || heightCm < 30 || heightCm > 250) errors.push('Height must be 30–250 cm.');
  if (!Number.isFinite(scr) || scr <= 0 || scr > 25) errors.push('SCr must be 0–25 mg/dL.');
  if (sex !== 'male' && sex !== 'female') errors.push('Sex must be male or female (for CrCl calculation).');

  return { ok: errors.length === 0, errors, normalized: { age, weightKg, heightCm, scr, sex } };
}

module.exports = {
  cockcroftGault,
  schwartzCrCl,
  devineIBW,
  adjustedBW,
  pickRenalRow,
  pediatricDose,
  dosingWeight,
  calculate,
  validatePatient
};
