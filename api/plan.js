'use strict';

const path = require('path');
const fs   = require('fs');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL         = process.env.FROGNAV_MODEL || 'claude-sonnet-4-20250514';
const TIMEOUT_MS    = 55_000; // under Vercel's 60s limit

const VALID_ACTIONS = new Set(['build', 'add_minor', 'honors', 'compare', 'chat']);

const REQUIRED_DISCLAIMER =
  'This is planning assistance only and does not replace official advising or the TCU degree audit system.';

// ── Helpers ───────────────────────────────────────────────────────────────────

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return null;
}

function err(res, status, detail, code) {
  return res.status(status).json({ code, detail });
}

function loadJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ── Term sequence ─────────────────────────────────────────────────────────────

function buildTermSequence(startTermRaw) {
  const m = String(startTermRaw || 'Fall 2026')
    .trim().match(/^(Fall|Spring|Summer)\s+(\d{4})$/i);
  let season = m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : 'Fall';
  let year   = m ? Number(m[2]) : 2026;
  // Summer is not a standard start term — snap forward to Fall
  if (season === 'Summer') { season = 'Fall'; }

  // Always start exactly at the given term — never go backwards
  const terms = [];
  while (terms.length < 8) {
    terms.push(`${season} ${year}`);
    if (season === 'Fall') { season = 'Spring'; year += 1; }
    else                   { season = 'Fall'; }
  }
  return terms;
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(profile, kineRules, genedRules, careerDefaults) {
  const major      = (kineRules.majors || {})[profile.majorProgram] || null;
  const minorData  = profile.minorProgram
    ? (kineRules.minors || {})[profile.minorProgram] || null
    : null;

  // Flatten major requirements into a readable list
  let majorBlock = '(major not found — use best judgment)';
  if (major) {
    majorBlock = (major.buckets || []).map(bucket => {
      const req  = (bucket.requiredCourses || []).join(', ') || 'none';
      const pick = bucket.chooseFrom
        ? `  Choose ${bucket.minCourses || 1} from: ${bucket.chooseFrom.join(', ')}`
        : '';
      return `${bucket.name}:\n  Required: ${req}${pick ? '\n' + pick : ''}`;
    }).join('\n\n');
  }

  // Flatten minor
  let minorBlock = 'None';
  if (minorData) {
    const req = (minorData.requiredCourses || []).join(', ');
    const elec = minorData.electiveCourses
      ? `\n  Choose ${minorData.electiveCourses.minCredits || 3} credits from: ${(minorData.electiveCourses.chooseFrom || []).join(', ')}`
      : '';
    minorBlock = `${profile.minorProgram}\n  Required: ${req}${elec}`;
  }

  // Gen-ed placeholders
   // Career-based course defaults
  const career = careerDefaults?.careerTracks?.[profile.careerGoal] || null;

  const genedList = (genedRules.buckets || []).map(b => {
    const recommended = career?.genedRecommendations?.[b.id];
    if (recommended && recommended.length) {
      return `- ${b.name}: PREFER ${recommended.join(' or ')} (fits career goal: ${profile.careerGoal})`;
    }
    return `- ${b.name}: use placeholder code "${b.placeholder}"`;
  }).join('\n') || '(none)';

  const careerElectivesBlock = career?.freeElectiveRecommendations?.length
    ? `CAREER-BASED FREE ELECTIVE RECOMMENDATIONS (career goal: ${profile.careerGoal}):\n` +
      career.freeElectiveRecommendations
        .map(c => `- ${c.code} — ${c.title} (${c.credits} cr): ${c.notes}`)
        .join('\n') +
      `\n\nCRITICAL ELECTIVE RULES:\n` +
      `1. Use ALL career elective recommendations above before using any generic FREE-ELECTIVE placeholder.\n` +
      `2. Sequence career electives strategically — prerequisites first, advanced courses later.\n` +
      `3. After exhausting career electives, fill remaining slots with TCU Core gen-ed courses (English, History, Government, Religion, Oral Communication, Cultural Awareness, Humanities, Social Sciences) — these are REQUIRED for graduation and must appear somewhere in the plan.\n` +
      `4. Only use FREE-ELECTIVE placeholders as a last resort when ALL career electives AND all TCU Core slots are filled.\n` +
      `5. A realistic 4-year plan should have NO MORE than 2-3 free elective placeholders total.`
    : `No career goal selected.\n` +
      `CRITICAL: Fill free elective slots with TCU Core gen-ed courses (English, History, Government, Religion, Oral Communication, Cultural Awareness, Humanities, Social Sciences) — these are REQUIRED for graduation.\n` +
      `Ask the student about their career interests in the questions field.\n` +
      `Add a nextStep button labeled "Set my career goal" with prompt "I'd like to set my career goal to get a more personalized plan. What are my options?"`;

  const careerAdvisingNote = career?.advisingNote
    ? `CAREER ADVISING NOTE: ${career.advisingNote}`
    : '';

  // Key policies
  const policies = kineRules.policies || {};
  const policyText = typeof policies === 'object' && !Array.isArray(policies)
    ? Object.values(policies).map(p => `- ${p}`).join('\n')
    : (Array.isArray(policies) ? policies.map(p => `- ${p}`).join('\n') : '(none)');

  const summerNote = profile.summerOptional
    ? 'Summer terms are OPTIONAL — only add one if required courses do not fit in Fall/Spring.'
    : 'Summer terms may be used freely.';

  return `You are FrogNav, a TCU Kinesiology degree-planning advisor.
Return ONLY a raw JSON object — no markdown, no code fences, no commentary.

STUDENT PROFILE:
- Level: ${profile.level}
- Major: ${profile.majorProgram || '(not set)'}
- Minor: ${profile.minorProgram || 'none'}
- Honors College: ${profile.honorsCollege ? 'Yes' : 'No'}
- Start Term: ${profile.startTerm || 'Fall 2026'}
- Credits per term: ${profile.creditsPerTerm || 15}
- ${summerNote}
- AP/Transfer credits: ${profile.apTransfer || 'None'}
- Already completed: ${profile.completedCourses || 'None'}
- Constraints: ${profile.constraints || 'None'}

MAJOR REQUIREMENTS — ${profile.majorProgram || 'N/A'}:
${majorBlock}

MINOR REQUIREMENTS:
${minorBlock}

TCU CORE (GEN-ED) PLACEHOLDERS — use these codes exactly for unspecified core slots:
${genedList}

CAREER GOAL: ${profile.careerGoal || 'Not set — ask the student in the questions field'}

${careerElectivesBlock}

${careerAdvisingNote}

SCHEDULING CONFLICT RULES (MUST follow when assigning courses to terms):
- NEVER schedule Exercise Physiology (KINE 30634) + Biomechanics (KINE 30623) + Physics (PHYS 10154) in the SAME semester. Spread these across different terms — at most two of these three may share a semester.
- NEVER schedule any Chemistry course (CHEM 10113, CHEM 10125) in the SAME semester as Physics (PHYS 10154). These heavy lab-science courses must be in separate terms.
If a conflict is unavoidable due to student constraints, add a policyWarning explaining it.

KEY POLICIES:
${policyText}

REQUIRED DISCLAIMER (end the disclaimer field with this exactly):
${REQUIRED_DISCLAIMER}

OUTPUT SCHEMA (return this exact structure, no extra keys):
{
  "planSummary": "string — 2-3 sentence overview",
  "profileEcho": {
    "level": "undergrad" | "grad",
    "major": "string",
    "minor": "string",
    "honors": boolean,
    "startTerm": "string",
    "targetGraduation": "string",
    "creditsPerTerm": number
  },
  "terms": [
    {
      "term": "Fall 2026",
      "courses": [
        { "code": "KINE 10101", "title": "Introduction to Kinesiology", "credits": 1, "notes": "string" }
      ],
      "totalCredits": number
    }
  ],
  "requirementChecklist": [
    { "item": "string", "status": "Met" | "In Progress" | "Planned" | "Needs Review", "notes": "string" }
  ],
  "policyWarnings": ["string"],
  "adjustmentOptions": ["string"],
  "assumptions": ["string"],
  "questions": ["string"],
  "nextSteps": [
    { "label": "string — short button label (max 5 words)", "prompt": "string — full prompt to send" }
  ],
  "disclaimer": "string"
}

CONVERSATIONAL RESPONSES:
If the student's message is casual conversation (greetings, thank-yous, general questions about kinesiology or TCU, clarifying questions NOT requesting a plan change), return this simpler JSON instead:
{
  "type": "chat",
  "message": "string — your friendly, helpful conversational reply",
  "nextSteps": [
    { "label": "string — short button label (max 5 words)", "prompt": "string — full prompt to send" }
  ]
}
IMPORTANT: Only use the chat format for messages that clearly do NOT require building, modifying, or comparing a degree plan. If the action is "build", "add_minor", "honors", or "compare", ALWAYS return the full plan schema above — never return chat format for those. If in doubt, return the full plan schema.`;
}

// ── Term ordering (for filtering stale terms) ─────────────────────────────────

function termOrder(termStr) {
  const m = String(termStr || '').match(/^(Fall|Spring|Summer)\s+(\d{4})$/i);
  if (!m) return 0;
  const year = Number(m[2]);
  const season = m[1].toLowerCase();
  const offset = season === 'spring' ? 0 : season === 'summer' ? 1 : 2;
  return year * 3 + offset;
}

// ── Response normalizer ───────────────────────────────────────────────────────

function normalizePlan(raw, profile) {
  const defaultTerms = buildTermSequence(profile.startTerm);

  // Normalize terms — keep AI-generated, fill gaps with empty slots
  const termMap = new Map();
  (raw.terms || []).forEach(t => {
    const key = String(t.term || '').trim();
    if (!key) return;
    const courses = (t.courses || []).map(c => ({
      code:    String(c.code    || 'TBD').trim(),
      title:   String(c.title   || '').trim(),
      credits: toNum(c.credits, 3),
      notes:   String(c.notes   || '').trim(),
    }));
    const totalCredits = courses.reduce((s, c) => s + c.credits, 0);
    termMap.set(key, { term: key, courses, totalCredits });
  });

  const terms = defaultTerms.map(label =>
    termMap.get(label) || { term: label, courses: [], totalCredits: 0 }
  );
  // Append any extra terms the AI added beyond the default 8,
  // but only if they come AFTER the start term (prevents stale Spring 2026 etc.)
  const startIdx = defaultTerms.length > 0
    ? termOrder(defaultTerms[0])
    : 0;
  (raw.terms || []).forEach(t => {
    const key = String(t.term || '').trim();
    if (key && !defaultTerms.includes(key) && termOrder(key) >= startIdx) {
      const entry = termMap.get(key);
      if (entry) terms.push(entry);
    }
  });

  // Guarantee disclaimer
  const disclaimer = String(raw.disclaimer || '').trim();
  const finalDisclaimer = disclaimer.endsWith(REQUIRED_DISCLAIMER)
    ? disclaimer
    : `${disclaimer ? disclaimer + ' ' : ''}${REQUIRED_DISCLAIMER}`.trim();

  // Guarantee assumption lines
  const assumptions = Array.isArray(raw.assumptions) ? [...raw.assumptions] : [];
  ['Term availability not provided; verify in TCU Class Search.',
   'Prerequisite sequencing assumed based on standard progression.']
    .forEach(line => { if (!assumptions.includes(line)) assumptions.push(line); });

  // ── Scheduling conflict detection ──────────────────────────────────────────
  const policyWarnings = (raw.policyWarnings || []).map(String);

  const EXERCISE_PHYS = 'KINE 30634';
  const BIOMECHANICS  = 'KINE 30623';
  const PHYSICS       = 'PHYS 10154';
  const CHEM_COURSES  = ['CHEM 10113', 'CHEM 10125'];

  terms.forEach(t => {
    const codes = (t.courses || []).map(c => String(c.code || '').toUpperCase().trim());
    // Rule 1: Exercise Physiology + Biomechanics + Physics all in same term
    if (codes.includes(EXERCISE_PHYS) && codes.includes(BIOMECHANICS) && codes.includes(PHYSICS)) {
      const msg = `Scheduling conflict in ${t.term}: Exercise Physiology (KINE 30634), Biomechanics (KINE 30623), and Physics (PHYS 10154) are all in the same semester. Spread these across different terms.`;
      if (!policyWarnings.includes(msg)) policyWarnings.push(msg);
    }
    // Rule 2: Chemistry + Physics in same term
    const hasChem = CHEM_COURSES.some(ch => codes.includes(ch));
    if (hasChem && codes.includes(PHYSICS)) {
      const msg = `Scheduling conflict in ${t.term}: Chemistry and Physics (PHYS 10154) are in the same semester. These heavy lab-science courses should be in separate terms.`;
      if (!policyWarnings.includes(msg)) policyWarnings.push(msg);
    }
  });

  return {
    planSummary: String(raw.planSummary || '').trim(),
    profileEcho: {
      level:            profile.level === 'grad' ? 'grad' : 'undergrad',
      major:            String(raw.profileEcho?.major || profile.majorProgram || '').trim(),
      minor:            String(raw.profileEcho?.minor || profile.minorProgram || '').trim(),
      honors:           Boolean(raw.profileEcho?.honors ?? profile.honorsCollege),
      startTerm:        String(raw.profileEcho?.startTerm || profile.startTerm || 'Fall 2026').trim(),
      targetGraduation: String(raw.profileEcho?.targetGraduation || profile.targetGraduation || '').trim(),
      creditsPerTerm:   toNum(raw.profileEcho?.creditsPerTerm ?? profile.creditsPerTerm, 15),
    },
    terms,
    requirementChecklist: (raw.requirementChecklist || []).map(item => ({
      item:   String(item.item   || '').trim(),
      status: ['Met','In Progress','Planned','Needs Review'].includes(item.status)
               ? item.status : 'Needs Review',
      notes:  String(item.notes  || '').trim(),
    })),
    policyWarnings,
    adjustmentOptions: (raw.adjustmentOptions || []).map(String),
    assumptions,
    questions: (raw.questions || []).map(String),
    nextSteps: (raw.nextSteps || []).slice(0, 3).map(s => ({
      label: String(s.label || '').trim(),
      prompt: String(s.prompt || '').trim(),
    })),
    disclaimer: finalDisclaimer,
  };
}

// ── Fallback plan ─────────────────────────────────────────────────────────────

function fallbackPlan(profile, warning) {
  return {
    planSummary: 'Fallback mode — backend encountered an issue. Please try again.',
    profileEcho: {
      level:            profile?.level === 'grad' ? 'grad' : 'undergrad',
      major:            String(profile?.majorProgram || '').trim(),
      minor:            String(profile?.minorProgram || '').trim(),
      honors:           Boolean(profile?.honorsCollege),
      startTerm:        String(profile?.startTerm || 'Fall 2026').trim(),
      targetGraduation: String(profile?.targetGraduation || '').trim(),
      creditsPerTerm:   toNum(profile?.creditsPerTerm, 15),
    },
    terms: buildTermSequence(profile?.startTerm).map(term => ({
      term, courses: [], totalCredits: 0,
    })),
    requirementChecklist: [
      { item: 'Advising review required', status: 'Needs Review', notes: warning },
    ],
    policyWarnings:    [warning, 'Fallback mode active — validate all requirements with official advising.'],
    adjustmentOptions: ['Retry the request.', 'Check /api/health for backend status.'],
    assumptions:       [
      'Term availability not provided; verify in TCU Class Search.',
      'Prerequisite sequencing assumed based on standard progression.',
    ],
    questions: ['Would you like to try again?'],
    nextSteps: [{ label: 'Try again', prompt: 'Please try building my plan again.' }],
    disclaimer: REQUIRED_DISCLAIMER,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // Method guard
  if (req.method !== 'POST') {
    return err(res, 405, 'Use POST /api/plan with JSON body.', 'FROGNAV_METHOD_NOT_ALLOWED');
  }

  // API key guard
  if (!process.env.ANTHROPIC_API_KEY) {
    return err(res, 503, 'ANTHROPIC_API_KEY is not configured.', 'FROGNAV_CONFIG');
  }

  // Parse body
  const body = readBody(req);
  if (!body || typeof body.profile !== 'object') {
    return err(res, 400, 'Expected JSON body: { action, profile, lastPlan?, message? }.', 'FROGNAV_BAD_REQUEST');
  }

  const profile = { ...body.profile };
  profile.level = String(profile.level || '').toLowerCase() === 'grad' ? 'grad' : 'undergrad';

  const action   = VALID_ACTIONS.has(body.action) ? body.action : 'chat';
  const message  = typeof body.message === 'string' ? body.message : '';
  const lastPlan = body.lastPlan && typeof body.lastPlan === 'object' ? body.lastPlan : null;

  // Load rules
  const kineFile  = path.join(process.cwd(), 'data',
    profile.level === 'grad' ? 'kine_rules_grad.json' : 'kine_rules_undergrad.json');
  const genedFile = path.join(process.cwd(), 'data', 'undergrad', 'gened_rules.json');

  const kineRules = loadJson(kineFile) || { majors: {}, minors: {}, policies: {} };
  const genedRules = profile.level === 'undergrad'
    ? (loadJson(genedFile) || { buckets: [] })
    : { buckets: [] };
  const careerDefaultsFile = path.join(process.cwd(), 'data', 'career_defaults.json');
  const careerDefaults = loadJson(careerDefaultsFile) || { careerTracks: {} };

  // Build prompt
  const systemPrompt = buildSystemPrompt(profile, kineRules, genedRules, careerDefaults);

  const userMessage = lastPlan
    ? `The student has an existing degree plan. Update or build on it based on their message — do NOT start from scratch. Preserve all existing terms and courses unless the student explicitly asks to change them.\n\nEXISTING PLAN:\n${JSON.stringify(lastPlan)}\n\nSTUDENT MESSAGE: ${message || action}`
    : JSON.stringify({ action, profile, message });

  // Call Claude with timeout
  const controller  = new AbortController();
  const abortTimer  = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method:  'POST',
      signal:  controller.signal,
      headers: {
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: 4096,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }],
      }),
    });
  } catch (fetchError) {
    clearTimeout(abortTimer);
    if (fetchError?.name === 'AbortError') {
      return err(res, 504, 'Request to AI model timed out. Please try again.', 'FROGNAV_TIMEOUT');
    }
    return err(res, 502, `Network error: ${fetchError.message}`, 'FROGNAV_NETWORK_ERROR');
  }
  clearTimeout(abortTimer);

  // Parse Claude response
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = payload?.error?.message || 'Upstream model request failed.';
    return err(res, response.status, String(msg).slice(0, 240), 'FROGNAV_API_ERROR');
  }

  const content = payload?.content?.[0]?.text;
  if (!content || typeof content !== 'string') {
    return err(res, 502, 'AI response had no text content.', 'FROGNAV_BAD_PAYLOAD');
  }

  // Strip markdown fences if present
  const cleaned = content.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  let rawPlan;
  try {
    rawPlan = JSON.parse(cleaned);
  } catch (parseError) {
    console.error('[plan] JSON parse error:', parseError.message, '\nRaw:', cleaned.slice(0, 300));
    return res.status(200).json(
      fallbackPlan(profile, `AI returned invalid JSON: ${parseError.message}`)
    );
  }

  // Conversational (non-plan) response
  if (rawPlan && rawPlan.type === 'chat' && typeof rawPlan.message === 'string') {
    return res.status(200).json({
      type: 'chat',
      message: rawPlan.message,
      nextSteps: Array.isArray(rawPlan.nextSteps)
        ? rawPlan.nextSteps.slice(0, 3).map(s => ({
            label: String(s.label || '').trim(),
            prompt: String(s.prompt || '').trim(),
          }))
        : [],
    });
  }

  return res.status(200).json(normalizePlan(rawPlan, profile));
};
