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

function buildSystemPrompt(profile, kineRules, genedRules, careerDefaults, transferEquiv) {
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
  // When no career goal is set, default to Pre-PT/OT/PA track — the most common
  // professional path for Kinesiology majors — so students get real course codes
  // instead of generic placeholders.
  const career = careerDefaults?.careerTracks?.[profile.careerGoal] || null;
  const defaultProTrack = careerDefaults?.careerTracks?.['Pre-PT/OT/DPT'] || null;
  const effectiveCareer = career || defaultProTrack;
  const careerGoalLabel = career ? profile.careerGoal : null;

  const genedList = (genedRules.buckets || []).map(b => {
    const recommended = effectiveCareer?.genedRecommendations?.[b.id];
    if (recommended && recommended.length) {
      const reason = careerGoalLabel
        ? `(fits career goal: ${careerGoalLabel})`
        : '(default: professional-track-appropriate for PT/OT/PA)';
      return `- ${b.name}: PREFER ${recommended.join(' or ')} ${reason}`;
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
    : defaultProTrack?.freeElectiveRecommendations?.length
    ? `No career goal selected — defaulting to professional-track (PT/OT/PA) electives.\n` +
      `DEFAULT FREE ELECTIVE RECOMMENDATIONS (Pre-PT/OT/PA track):\n` +
      defaultProTrack.freeElectiveRecommendations
        .map(c => `- ${c.code} — ${c.title} (${c.credits} cr): ${c.notes}`)
        .join('\n') +
      `\n\nCRITICAL ELECTIVE RULES:\n` +
      `1. Use the default elective recommendations above before using any generic FREE-ELECTIVE placeholder.\n` +
      `2. Sequence electives strategically — prerequisites first, advanced courses later.\n` +
      `3. After exhausting default electives, fill remaining slots with TCU Core gen-ed courses (English, History, Government, Religion, Oral Communication, Cultural Awareness, Humanities, Social Sciences) — these are REQUIRED for graduation and must appear somewhere in the plan.\n` +
      `4. Only use FREE-ELECTIVE placeholders as a last resort when ALL default electives AND all TCU Core slots are filled.\n` +
      `5. A realistic 4-year plan should have NO MORE than 2-3 free elective placeholders total.\n` +
      `6. Ask the student about their career interests in the questions field.\n` +
      `7. Add a nextStep button labeled "Set my career goal" with prompt "I'd like to set my career goal to get a more personalized plan. What are my options?"`
    : `No career goal selected.\n` +
      `CRITICAL: Fill free elective slots with TCU Core gen-ed courses (English, History, Government, Religion, Oral Communication, Cultural Awareness, Humanities, Social Sciences) — these are REQUIRED for graduation.\n` +
      `Ask the student about their career interests in the questions field.\n` +
      `Add a nextStep button labeled "Set my career goal" with prompt "I'd like to set my career goal to get a more personalized plan. What are my options?"`;

  const careerAdvisingNote = career?.advisingNote
    ? `CAREER ADVISING NOTE: ${career.advisingNote}`
    : '';

  // AP & Transfer credit equivalencies
  const transferCoreBlock = (transferEquiv?.core || []).map(area =>
    `${area.coreCode} (${area.category}, ${area.requiredHours} hrs): ${area.courses.map(c => c.code).join(', ')}`
  ).join('\n');
  const transferNonCoreBlock = (transferEquiv?.nonCore || []).map(area =>
    `${area.category}: ${area.courses.map(c => c.code).join(', ')}`
  ).join('\n');

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

TCU CORE MATHEMATICAL REASONING REQUIREMENT:
Any ONE of the following courses satisfies the TCU Core Math requirement:
- MATH 10033 — Topics in Mathematics (3 cr)
- MATH 10043 — Elementary Statistics (3 cr)
- MATH 10283 — Applied Calculus (3 cr)
- MATH 10524 — Calculus I (4 cr)
- MATH 20524 — Calculus II (4 cr)
If ANY of these courses appears in the student's schedule, the TCU Core Math requirement IS MET. Do NOT flag it as unmet. The student's degree program may require additional math courses beyond core — those are separate requirements.

CAREER GOAL: ${profile.careerGoal || 'Not set — ask the student in the questions field'}

${careerElectivesBlock}

${careerAdvisingNote}

ELECTIVE AND CORE COURSE DEFAULTING — STRICT HIERARCHY:
When filling TCU CORE elective slots, free electives, or any open course slots, follow this priority order. Use the HIGHEST applicable tier and never skip to a lower tier if a higher one applies:

1. MAJOR REQUIREMENTS — If the student's major has unfulfilled required or recommended courses, fill open slots with those first.
2. MINOR / EMPHASIS REQUIREMENTS — If the student has a declared minor or emphasis with unfulfilled courses, fill open slots with those next.
3. CAREER GOAL ALIGNMENT — If the student has a career goal set, choose electives that directly support that path. Examples:
   - Pre-PT/OT/PA: prioritize BIOL, CHEM, PHYS, HLTH, and anatomy/physiology-adjacent courses
   - Coaching/S&C: prioritize KINE 30343, KINE 40513, KINE 40543, sport psychology courses
   - Teaching/PE: prioritize education-track and pedagogy courses
   - Sport & Exercise Psychology: prioritize psychology electives and research methods
4. CHAT CONTEXT — If the student has mentioned interests, preferences, or constraints during the conversation that suggest specific courses, use those to inform elective choices.
5. DEFAULT FALLBACK — If none of the above apply (no major set, no minor, no career goal, no chat context), default to courses that best serve a Movement Science major pursuing pre-professional programs (PT, OT, PA). This means prioritizing:
   - BIOL 20204 (Human Anatomy & Physiology I)
   - BIOL 20214 (Human Anatomy & Physiology II)
   - CHEM 10114 (General Chemistry I)
   - PHYS 10154 (General Physics I)
   - HLTH 30423 (Nutrition & Physical Activity)
   - KINE 30523 (Exercise Assessment & Prescription)
   - Psychology, statistics, and research methods courses

NEVER use generic "FREE ELECTIVE" or "TCU CORE — Elective" placeholders when a real course from the above hierarchy would apply. Only use placeholders as an absolute last resort when ALL tiers above are exhausted and no specific course can be reasonably recommended.

AP & TRANSFER CREDIT EQUIVALENCIES:
If a student lists AP or transfer credits, use these mappings to determine which TCU course requirements are satisfied. Mark those requirements as "Met via AP or Transfer" in the requirement checklist.

Core Requirements:
${transferCoreBlock}

Non-Core Prerequisites:
${transferNonCoreBlock}

SCHEDULING CONFLICT RULES (MUST follow when assigning courses to terms):
- NEVER schedule Exercise Physiology (KINE 30634) + Biomechanics (KINE 30623) + Physics (PHYS 10154) in the SAME semester. Spread these across different terms — at most two of these three may share a semester.
- NEVER schedule any Chemistry course (CHEM 10113, CHEM 10125) in the SAME semester as Physics (PHYS 10154). These heavy lab-science courses must be in separate terms.
If a conflict is unavoidable due to student constraints, add a policyWarning explaining it.

COURSE DISTRIBUTION RULES:
- Spread TCU Core (gen-ed) courses across the FIRST 4 semesters (freshman and sophomore years). Students should NOT have a heavy load of gen-ed courses in junior/senior year — those semesters should focus on major, emphasis, and career-driven electives.
- Each semester should have a balanced mix of major requirements and gen-ed courses, not clusters of one type.
- Junior/Senior semesters (semesters 5-8) should be primarily major core, emphasis, foundation, and career-track elective courses.

KEY POLICIES:
${policyText}

REQUIRED DISCLAIMER (end the disclaimer field with this exactly):
${REQUIRED_DISCLAIMER}

SCHEDULING AWARENESS — KINE/HLTH Course Offering Patterns:
Use this data when placing courses into semesters. Do NOT schedule a Fall-only course in Spring or vice versa.

FALL ONLY courses (do NOT place in Spring):
- KINE 20403 PHED For Elem Sch Children (TR)
- KINE 30343 Theory of Coaching (MWF)
- KINE 30723 Sociology of Sport (TR)
- KINE 30733 Exercise Psychology (TR)
- KINE 40103 Seminar in Kinesiology (TR)
- KINE 40313 Sport Skills Techn & Analysis (TR)
- KINE 40513 Principles of Strength & Cond (MWF)

SPRING ONLY courses (do NOT place in Fall):
- KINE 30443 Coaching Pedagogy & Practice (TR)
- KINE 40543 Adv Strength and Conditioning (MWF)
- KINE 40623 PE For Secondary Youth (TR)
- HLTH 40203 Study Of Human Disease (TR)

FALL + SPRING courses (available both semesters):
- KINE 10101 Introduction to Kinesiology (8-week, MW)
- KINE 10603 Anatomical Kinesiology (MWF)
- KINE 20313 Foundations of Sport Injuries (TR)
- KINE 30403 Motor Behavior (MWF)
- KINE 30423 Motor Development (MWF)
- KINE 30523 Exercise Assessment & Prescription (MWF)
- KINE 30623 Biomechanics (Fall: MWF, Spring: TR — days change by semester)
- KINE 30634 Exercise Physiology (MWF + lab on a separate day)
- KINE 30833 Phys Activity and Disability (TR)
- KINE 30843 Neuromuscular Pathophysiology (TR)
- KINE 30713 Psychology of Sport (Spring, TR)
- HLTH 20203 Health & Wellness Concepts (TR or single day)
- HLTH 30203 Health & Stress Management (mixed days)
- HLTH 30213 Health Aspects of Human Sexuality (TR)
- HLTH 30423 Nutrition & Physical Activity (TR)

COURSES WITH LABS:
- KINE 30634 Exercise Physiology — lecture MWF + 1 lab day (M, T, W, or R depending on section)

DAY PATTERNS for constraint checking:
- MWF courses: KINE 10603, 30403, 30423, 30523, 30623 (Fall), 30634, 30343 (Fall), 40513 (Fall), 40543 (Spring)
- TR courses: KINE 20313, 20403 (Fall), 30623 (Spring), 30723 (Fall), 30733 (Fall), 30833, 30843, 40103 (Fall), 40313 (Fall), 30713 (Spring), HLTH 20203, 30213, 30423, 40203 (Spring)

CONSTRAINT RULES:
- If student says "No Friday classes": flag all MWF courses. Suggest TR alternatives where available.
- If student says "No classes before 10am": note that morning sections are common. Check availability.
- KINE 30623 (Biomechanics) switches from MWF in Fall to TR in Spring — if student has MWF constraints, suggest Spring.
- KINE 30634 (Exercise Physiology) labs require a separate day block — warn students with tight schedules.
- For any affected course add a note: "Heads up: [COURSE] is typically offered [DAYS] — this may conflict with your [CONSTRAINT]. Register early or consider taking it in [ALT SEMESTER] instead."

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
  "questions": ["string — see QUESTION GUIDELINES below"],
  "nextSteps": [
    { "label": "string — short button label (max 5 words)", "prompt": "string — full prompt to send" }
  ],
  "disclaimer": "string"
}

QUESTION GUIDELINES (for the "questions" field):
Generate 2-4 thoughtful, personalized questions that will directly improve this specific student's plan. Questions should:
- Be based on THIS student's profile, major, career goal (or lack of one), and current plan gaps
- Reference specific details from their plan (e.g., "I noticed you have room in Spring 2028 — would you like to add a research methods course?")
- Help uncover information that would change course recommendations (career goals, grad school plans, certification interests, scheduling preferences)
- Feel like a conversation with a knowledgeable advisor, not a generic intake form
- NEVER repeat questions the student has already answered in the conversation history
- NEVER ask generic questions like "Do you have any questions?" or "Is there anything else?"
- Frame each question so the student understands HOW their answer will improve the plan

Examples of GOOD questions (adapt to the student's actual situation):
- "Your plan includes the Pre-PT prerequisite courses. Are you targeting specific DPT programs? Some require additional courses like Medical Terminology."
- "You have 3 credit hours of flexibility in Fall 2028. Would you prefer a research-focused elective like Independent Study, or a clinical one like Exercise Assessment?"
- "Since you're in Movement Science without a career goal set, are you leaning toward graduate school, professional programs (PT/OT/PA), or entering the workforce directly? This changes which electives I'd recommend."
- "I see you don't have a minor selected. Have you considered a Psychology minor? It pairs well with your emphasis and only requires 3 additional courses."

REVISION CONFIRMATION RULE:
When the student has an EXISTING PLAN and requests a change (swap a course, move a course to a different semester, drop/add a course, change credit load, etc.), do NOT immediately regenerate the full plan. Instead, FIRST confirm the revision using the chat format below:
1. Summarize exactly what you understand the student wants changed.
2. Note any side effects (prerequisite shifts, credit-load changes, scheduling conflicts).
3. Provide a "Yes, apply changes" nextStep button whose prompt repeats the revision request naturally (e.g., "Please apply the following changes to my plan: swap KINE 30713 for PSYC 30213 in Spring 2028"). Do NOT prefix prompts with "CONFIRMED:" or any special tags — just use natural language.
4. Optionally provide an "Adjust request" button if ambiguity exists.

When the student's message clearly states they want to apply specific changes (e.g., "Please apply...", "Go ahead and...", "Yes, swap..."), skip confirmation and immediately apply the change — return the full plan schema with the revision applied.

CONVERSATIONAL RESPONSES:
If the student's message is casual conversation (greetings, thank-yous, general questions about kinesiology or TCU, clarifying questions NOT requesting a plan change), return this simpler JSON instead:
{
  "type": "chat",
  "message": "string — your friendly, helpful conversational reply",
  "nextSteps": [
    { "label": "string — short button label (max 5 words)", "prompt": "string — full prompt to send" }
  ]
}
Also use the chat format for revision confirmations (see REVISION CONFIRMATION RULE above).

When a student asks about focusing on research, adding experiences, exploring career paths, or any topic that involves DISCUSSING changes before applying them, use the chat format to:
1. Explain what you'd recommend changing in their plan
2. List the specific courses you'd add, swap, or move
3. Provide a nextStep button like "Apply these changes" whose prompt naturally describes the changes (e.g., "Please apply these changes to my plan: add BIOL 30204 in Fall 2028, swap KINE 30713 for PSYC 30213 in Spring 2028"). No special prefixes — just clear, natural language.
This ensures the student sees your reasoning and confirms before their schedule changes.

CRITICAL: You MUST always return valid JSON — either the full plan schema or the chat schema above. NEVER return plain text outside of JSON. Every response must be parseable JSON.

IMPORTANT: Only use the chat format for messages that clearly do NOT require building, modifying, or comparing a degree plan, OR for confirming a revision before applying it. If the action is "build", "add_minor", "honors", or "compare", ALWAYS return the full plan schema above — never return chat format for those. If in doubt, return the full plan schema.`;
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

// ── Checklist status normalizer ───────────────────────────────────────────────

function normalizeChecklistStatus(status) {
  const canonical = ['Met', 'In Progress', 'Planned', 'Needs Review'];
  if (canonical.includes(status)) return status;
  const s = status.toLowerCase();
  // Negative signals → Needs Review
  if (/\b(need|missing|short|incomplete|not met|pending|under|below|review|lacks?)\b/.test(s)) {
    return 'Needs Review';
  }
  // Positive signals → Met
  if (/\b(met|complete|satisfied|included|scheduled|distributed|covered|fulfilled|on track|most|all\b)/.test(s)) {
    return 'Met';
  }
  // Progress signals → Planned
  if (/\b(planned|progress|partial)\b/.test(s)) return 'Planned';
  return 'Needs Review';
}

// ── Response normalizer ───────────────────────────────────────────────────────

function normalizePlan(raw, profile, careerDefaults, coreCodeMap) {
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

  // ── Replace TCU-CORE and FREE-ELECTIVE placeholders with actual courses ───
  const rpCareer = careerDefaults?.careerTracks?.[profile.careerGoal] || null;
  const rpDefault = careerDefaults?.careerTracks?.['Pre-PT/OT/DPT'] || null;
  const rpTrack = rpCareer || rpDefault;

  // Build gen-ed replacement map from career defaults
  // Maps placeholder patterns → actual course codes
  const genedMap = {};
  const genedRecs = rpTrack?.genedRecommendations || {};
  // Map various placeholder patterns the AI might use to the career defaults keys
  const genedAliases = {
    'GENED-COMM':    ['TCU-CORE-ORAL', 'TCU-CORE-OCO', 'GENED-COMM', 'TCU-CORE-COMM', 'ORAL-CORE', 'ORAL-COMM-CORE', 'SPEECH-CORE', 'TCU-OCO', 'TCU-ORAL', 'TCU-COMM', 'TCU-SPEECH'],
    'GENED-ENGLISH': ['TCU-CORE-WCO', 'TCU-CORE-WCO1', 'TCU-CORE-WCO2', 'TCU-CORE-WEM', 'TCU-CORE-ENGLISH', 'GENED-ENGLISH', 'TCU-CORE-WRIT', 'ENGLISH-CORE', 'WRITING-CORE', 'COMP-CORE', 'TCU-WCO', 'TCU-WCO1', 'TCU-WCO2', 'TCU-WEM', 'TCU-ENGLISH', 'TCU-WRIT'],
    'GENED-MATH':    ['TCU-CORE-MATH', 'GENED-MATH', 'MATH-CORE', 'TCU-MATH', 'TCU-MTH'],
    'GENED-SCI-NAT': ['TCU-CORE-NSC', 'TCU-CORE-SCI', 'GENED-SCI-NAT', 'TCU-CORE-NAT', 'SCIENCE-CORE', 'SCI-CORE', 'NAT-SCI-CORE', 'TCU-NSC', 'TCU-SCI', 'TCU-NAT'],
    'GENED-HIST':    ['TCU-CORE-HIST', 'TCU-CORE-HT', 'GENED-HIST', 'HIST-CORE', 'HISTORY-CORE', 'HIST-TRAD-CORE', 'TCU-HT', 'TCU-HIST'],
    'GENED-GOV':     ['TCU-CORE-GOV', 'TCU-CORE-CSV', 'GENED-GOV', 'GOV-CORE', 'GOVT-CORE', 'CITIZEN-CORE', 'CSV-CORE', 'TCU-CSV', 'TCU-GOV', 'TCU-GOVT'],
    'GENED-SOCIAL':  ['TCU-CORE-SOSC', 'TCU-CORE-SSC', 'TCU-CORE-SOC', 'GENED-SOCIAL', 'SOCI-CORE', 'SOCIAL-CORE', 'SOCIAL-SCIENCE-CORE', 'TCU-SSC', 'TCU-SOSC', 'TCU-SOC'],
    'GENED-HUM':     ['TCU-CORE-HUM', 'GENED-HUM', 'HUMANITIES-CORE', 'HUM-CORE', 'TCU-HUM'],
    'GENED-RELIGION':['TCU-CORE-REL', 'TCU-CORE-RELI', 'TCU-CORE-RT', 'GENED-RELIGION', 'RELIG-CORE', 'RELIGION-CORE', 'RELIG-TRAD-CORE', 'TCU-RT', 'TCU-REL', 'TCU-RELI'],
    'GENED-CULTURE': ['TCU-CORE-CULT', 'TCU-CORE-CA', 'GENED-CULTURE', 'CULT-AWARE-CORE', 'CULTURE-CORE', 'CULTURAL-CORE', 'TCU-CA', 'TCU-CULT'],
    'GENED-FINE-ART':['TCU-CORE-FA', 'TCU-CORE-FAR', 'TCU-CORE-FINE', 'GENED-FINE-ART', 'FINE-ART-CORE', 'FINE-ARTS-CORE', 'ART-CORE', 'TCU-FAR', 'TCU-FA', 'TCU-FINE'],
    'GENED-LIT':     ['TCU-CORE-LIT', 'TCU-CORE-LT', 'GENED-LIT', 'LITER-TRAD-CORE', 'LIT-CORE', 'LITERARY-CORE', 'TCU-LT', 'TCU-LIT'],
    'GENED-GLOBAL':  ['TCU-CORE-GA', 'TCU-CORE-GLOBAL', 'GENED-GLOBAL', 'GLOBAL-AWARE-CORE', 'GLOBAL-CORE', 'TCU-GA', 'TCU-GLOBAL'],
  };
  // Fallback course codes for gen-ed areas when career defaults don't cover them
  const genedFallbacks = {
    'TCU-CORE-ORAL': { code: 'COMM 10003', title: 'Oral Communication', credits: 3, notes: 'TCU Core requirement' },
    'TCU-CORE-OCO':  { code: 'COMM 10003', title: 'Oral Communication', credits: 3, notes: 'TCU Core requirement' },
    'TCU-CORE-COMM': { code: 'COMM 10003', title: 'Oral Communication', credits: 3, notes: 'TCU Core requirement' },
    'TCU-CORE-HUM':  { code: 'PHIL 10003', title: 'Introduction to Philosophy', credits: 3, notes: 'TCU Core Humanities requirement' },
    'TCU-CORE-CULT': { code: 'ANTH 10013', title: 'Introduction to Anthropology', credits: 3, notes: 'TCU Core Cultural Awareness requirement' },
    'TCU-CORE-CA':   { code: 'ANTH 10013', title: 'Introduction to Anthropology', credits: 3, notes: 'TCU Core Cultural Awareness requirement' },
    'TCU-CORE-REL':  { code: 'RELI 10003', title: 'Introduction to Religion', credits: 3, notes: 'TCU Core Religious Traditions requirement' },
    'TCU-CORE-RELI': { code: 'RELI 10003', title: 'Introduction to Religion', credits: 3, notes: 'TCU Core Religious Traditions requirement' },
    'TCU-CORE-RT':   { code: 'RELI 10003', title: 'Introduction to Religion', credits: 3, notes: 'TCU Core Religious Traditions requirement' },
    'TCU-CORE-HIST': { code: 'HIST 10953', title: 'History of Civilization', credits: 3, notes: 'TCU Core Historical Traditions requirement' },
    'TCU-CORE-HT':   { code: 'HIST 10953', title: 'History of Civilization', credits: 3, notes: 'TCU Core Historical Traditions requirement' },
    'TCU-CORE-GOV':  { code: 'POLS 10040', title: 'American Government', credits: 3, notes: 'TCU Core requirement' },
    'TCU-CORE-CSV':  { code: 'POLS 10040', title: 'American Government', credits: 3, notes: 'TCU Core Citizenship requirement' },
    'TCU-CORE-SOSC': { code: 'PSYC 10213', title: 'Introduction to Psychology', credits: 3, notes: 'TCU Core Social Sciences requirement' },
    'TCU-CORE-SSC':  { code: 'PSYC 10213', title: 'Introduction to Psychology', credits: 3, notes: 'TCU Core Social Sciences requirement' },
    'TCU-CORE-SOC':  { code: 'PSYC 10213', title: 'Introduction to Psychology', credits: 3, notes: 'TCU Core Social Sciences requirement' },
    'TCU-CORE-MATH': { code: 'MATH 10043', title: 'Elementary Statistics', credits: 3, notes: 'TCU Core Math requirement (also satisfied by MATH 10033, 10283, 10524, or 20524)' },
    'TCU-CORE-FA':   { code: 'MUSC 10003', title: 'Introduction to Music', credits: 3, notes: 'TCU Core Fine Arts requirement' },
    'TCU-CORE-FAR':  { code: 'MUSC 10003', title: 'Introduction to Music', credits: 3, notes: 'TCU Core Fine Arts requirement' },
    'TCU-CORE-FINE': { code: 'MUSC 10003', title: 'Introduction to Music', credits: 3, notes: 'TCU Core Fine Arts requirement' },
    'TCU-CORE-LIT':  { code: 'ENGL 20803', title: 'British Literature', credits: 3, notes: 'TCU Core Literary Traditions requirement' },
    'TCU-CORE-LT':   { code: 'ENGL 20803', title: 'British Literature', credits: 3, notes: 'TCU Core Literary Traditions requirement' },
    'TCU-CORE-WCO':  { code: 'ENGL 10803', title: 'Composition', credits: 3, notes: 'TCU Core Written Communication requirement' },
    'TCU-CORE-WCO1': { code: 'ENGL 10803', title: 'Composition', credits: 3, notes: 'TCU Core Written Communication I requirement' },
    'TCU-CORE-WCO2': { code: 'ENGL 20803', title: 'British Literature', credits: 3, notes: 'TCU Core Written Communication II requirement' },
    'TCU-CORE-WEM':  { code: 'ENGL 20803', title: 'British Literature', credits: 3, notes: 'TCU Core Writing Emphasis requirement' },
    'TCU-CORE-ENGLISH': { code: 'ENGL 10803', title: 'Composition', credits: 3, notes: 'TCU Core Written Communication requirement' },
    'TCU-CORE-WRIT': { code: 'ENGL 10803', title: 'Composition', credits: 3, notes: 'TCU Core Written Communication requirement' },
    'TCU-CORE-GA':   { code: 'SPAN 10114', title: 'Beginning Spanish I', credits: 3, notes: 'TCU Core Global Awareness requirement' },
    'TCU-CORE-GLOBAL': { code: 'SPAN 10114', title: 'Beginning Spanish I', credits: 3, notes: 'TCU Core Global Awareness requirement' },
    // TCU-XXX short forms (AI omits -CORE-)
    'TCU-OCO':   { code: 'COMM 10003', title: 'Oral Communication', credits: 3, notes: 'TCU Core requirement' },
    'TCU-ORAL':  { code: 'COMM 10003', title: 'Oral Communication', credits: 3, notes: 'TCU Core requirement' },
    'TCU-COMM':  { code: 'COMM 10003', title: 'Oral Communication', credits: 3, notes: 'TCU Core requirement' },
    'TCU-SPEECH':{ code: 'COMM 10003', title: 'Oral Communication', credits: 3, notes: 'TCU Core requirement' },
    'TCU-WCO':   { code: 'ENGL 10803', title: 'Composition', credits: 3, notes: 'TCU Core Written Communication requirement' },
    'TCU-WCO1':  { code: 'ENGL 10803', title: 'Composition', credits: 3, notes: 'TCU Core Written Communication I requirement' },
    'TCU-WCO2':  { code: 'ENGL 20803', title: 'British Literature', credits: 3, notes: 'TCU Core Written Communication II requirement' },
    'TCU-WEM':   { code: 'ENGL 20803', title: 'British Literature', credits: 3, notes: 'TCU Core Writing Emphasis requirement' },
    'TCU-ENGLISH':{ code: 'ENGL 10803', title: 'Composition', credits: 3, notes: 'TCU Core Written Communication requirement' },
    'TCU-WRIT':  { code: 'ENGL 10803', title: 'Composition', credits: 3, notes: 'TCU Core Written Communication requirement' },
    'TCU-MATH':  { code: 'MATH 10043', title: 'Elementary Statistics', credits: 3, notes: 'TCU Core Math requirement' },
    'TCU-MTH':   { code: 'MATH 10043', title: 'Elementary Statistics', credits: 3, notes: 'TCU Core Math requirement' },
    'TCU-NSC':   { code: 'BIOL 10504', title: 'General Biology', credits: 4, notes: 'TCU Core Natural Science requirement' },
    'TCU-SCI':   { code: 'BIOL 10504', title: 'General Biology', credits: 4, notes: 'TCU Core Natural Science requirement' },
    'TCU-NAT':   { code: 'BIOL 10504', title: 'General Biology', credits: 4, notes: 'TCU Core Natural Science requirement' },
    'TCU-HT':    { code: 'HIST 10953', title: 'History of Civilization', credits: 3, notes: 'TCU Core Historical Traditions requirement' },
    'TCU-HIST':  { code: 'HIST 10953', title: 'History of Civilization', credits: 3, notes: 'TCU Core Historical Traditions requirement' },
    'TCU-CSV':   { code: 'POLS 10040', title: 'American Government', credits: 3, notes: 'TCU Core Citizenship requirement' },
    'TCU-GOV':   { code: 'POLS 10040', title: 'American Government', credits: 3, notes: 'TCU Core requirement' },
    'TCU-GOVT':  { code: 'POLS 10040', title: 'American Government', credits: 3, notes: 'TCU Core requirement' },
    'TCU-SSC':   { code: 'PSYC 10213', title: 'Introduction to Psychology', credits: 3, notes: 'TCU Core Social Sciences requirement' },
    'TCU-SOSC':  { code: 'PSYC 10213', title: 'Introduction to Psychology', credits: 3, notes: 'TCU Core Social Sciences requirement' },
    'TCU-SOC':   { code: 'PSYC 10213', title: 'Introduction to Psychology', credits: 3, notes: 'TCU Core Social Sciences requirement' },
    'TCU-HUM':   { code: 'PHIL 10003', title: 'Introduction to Philosophy', credits: 3, notes: 'TCU Core Humanities requirement' },
    'TCU-RT':    { code: 'RELI 10003', title: 'Introduction to Religion', credits: 3, notes: 'TCU Core Religious Traditions requirement' },
    'TCU-REL':   { code: 'RELI 10003', title: 'Introduction to Religion', credits: 3, notes: 'TCU Core Religious Traditions requirement' },
    'TCU-RELI':  { code: 'RELI 10003', title: 'Introduction to Religion', credits: 3, notes: 'TCU Core Religious Traditions requirement' },
    'TCU-CA':    { code: 'ANTH 10013', title: 'Introduction to Anthropology', credits: 3, notes: 'TCU Core Cultural Awareness requirement' },
    'TCU-CULT':  { code: 'ANTH 10013', title: 'Introduction to Anthropology', credits: 3, notes: 'TCU Core Cultural Awareness requirement' },
    'TCU-FAR':   { code: 'MUSC 10003', title: 'Introduction to Music', credits: 3, notes: 'TCU Core Fine Arts requirement' },
    'TCU-FA':    { code: 'MUSC 10003', title: 'Introduction to Music', credits: 3, notes: 'TCU Core Fine Arts requirement' },
    'TCU-FINE':  { code: 'MUSC 10003', title: 'Introduction to Music', credits: 3, notes: 'TCU Core Fine Arts requirement' },
    'TCU-LT':    { code: 'ENGL 20803', title: 'British Literature', credits: 3, notes: 'TCU Core Literary Traditions requirement' },
    'TCU-LIT':   { code: 'ENGL 20803', title: 'British Literature', credits: 3, notes: 'TCU Core Literary Traditions requirement' },
    'TCU-GA':    { code: 'SPAN 10114', title: 'Beginning Spanish I', credits: 3, notes: 'TCU Core Global Awareness requirement' },
    'TCU-GLOBAL':{ code: 'SPAN 10114', title: 'Beginning Spanish I', credits: 3, notes: 'TCU Core Global Awareness requirement' },
  };

  // Build reverse lookup: placeholder code → { code, title, credits, notes }
  for (const [genedKey, aliases] of Object.entries(genedAliases)) {
    const recCodes = genedRecs[genedKey];
    if (recCodes && recCodes.length) {
      const code = recCodes[0]; // Use first recommended course
      aliases.forEach(alias => {
        genedMap[alias.toUpperCase()] = { code, title: '', credits: 3, notes: 'TCU Core requirement' };
      });
    }
  }

  // Detect any placeholder code — real TCU courses never start with TCU- or contain CORE/ELECTIVE
  function isPlaceholder(code) {
    return code.startsWith('TCU-') || code.startsWith('GENED-')
      || code.startsWith('FREE') || /\bCORE\b/.test(code)
      || /\bELECTIVE\b/.test(code);
  }

  // Free elective pool from career defaults
  const elecPool = (rpTrack?.freeElectiveRecommendations || []).slice();
  // Track codes already in the plan (real courses only)
  const usedCodes = new Set();
  terms.forEach(t => (t.courses || []).forEach(c => {
    const code = String(c.code || '').toUpperCase().trim();
    if (!isPlaceholder(code)) {
      usedCodes.add(code);
    }
  }));

  // Resolve a placeholder code into an actual course
  function resolvePlaceholder(c) {
    const code = String(c.code || '').toUpperCase().trim();

    // FREE-ELECTIVE → career elective, then gen-ed fallback
    if (code === 'FREE-ELECTIVE' || code.startsWith('FREE-ELECTIVE') || code.startsWith('FREE')
        || /\bELECTIVE\b/.test(code)) {
      const credits = c.credits || 3;
      const idx = elecPool.findIndex(e => !usedCodes.has(e.code.toUpperCase()) && e.credits === credits);
      if (idx !== -1) {
        const repl = elecPool[idx];
        usedCodes.add(repl.code.toUpperCase());
        return { code: repl.code, title: repl.title, credits: repl.credits, notes: repl.notes };
      }
      const anyIdx = elecPool.findIndex(e => !usedCodes.has(e.code.toUpperCase()));
      if (anyIdx !== -1) {
        const repl = elecPool[anyIdx];
        usedCodes.add(repl.code.toUpperCase());
        return { code: repl.code, title: repl.title, credits: repl.credits, notes: repl.notes };
      }
      for (const fb of Object.values(genedFallbacks)) {
        if (!usedCodes.has(fb.code.toUpperCase())) {
          usedCodes.add(fb.code.toUpperCase());
          return { ...fb };
        }
      }
    }

    // Any CORE placeholder → look up via alias map or fallback map
    if (/\bCORE\b/.test(code) || code.startsWith('TCU-CORE') || code.startsWith('GENED-')) {
      const mapped = genedMap[code];
      if (mapped && !usedCodes.has(mapped.code.toUpperCase())) {
        usedCodes.add(mapped.code.toUpperCase());
        return { code: mapped.code, title: mapped.title || c.title, credits: mapped.credits || c.credits, notes: mapped.notes || c.notes };
      }
      const fb = genedFallbacks[code];
      if (fb && !usedCodes.has(fb.code.toUpperCase())) {
        usedCodes.add(fb.code.toUpperCase());
        return { ...fb };
      }
      if (fb) return { ...fb };

      // Keyword catch-all: match unknown CORE placeholders to fallbacks by keyword
      const codeLC = code.toLowerCase();
      const keywordMap = [
        [/soci|social/,     'TCU-CORE-SOSC'],
        [/human|hum/,       'TCU-CORE-HUM'],
        [/liter|lit/,       'TCU-CORE-LIT'],
        [/global|aware/,    'TCU-CORE-GA'],
        [/cult/,            'TCU-CORE-CULT'],
        [/relig/,           'TCU-CORE-REL'],
        [/hist/,            'TCU-CORE-HIST'],
        [/oral|speech|comm/,'TCU-CORE-OCO'],
        [/engl|writ|comp/,  'TCU-CORE-WCO'],
        [/math/,            'TCU-CORE-MATH'],
        [/sci|nat|phys|bio|chem/, 'TCU-CORE-NSC'],
        [/fine|art|music/,  'TCU-CORE-FA'],
        [/gov|citizen|csv/, 'TCU-CORE-GOV'],
      ];
      for (const [pattern, fbKey] of keywordMap) {
        if (pattern.test(codeLC)) {
          const kwFb = genedFallbacks[fbKey];
          if (kwFb && !usedCodes.has(kwFb.code.toUpperCase())) {
            usedCodes.add(kwFb.code.toUpperCase());
            return { ...kwFb };
          }
          if (kwFb) return { ...kwFb };
        }
      }

      // Last resort: return any unused fallback rather than showing a placeholder
      for (const fb of Object.values(genedFallbacks)) {
        if (!usedCodes.has(fb.code.toUpperCase())) {
          usedCodes.add(fb.code.toUpperCase());
          return { ...fb };
        }
      }
    }

    return null;
  }

  // Pass 1: Pull all placeholders out of terms, resolve them, collect for redistribution
  const maxCredits = toNum(profile.creditsPerTerm, 15);
  const resolved = []; // courses to redistribute into early semesters
  terms.forEach(t => {
    const keep = [];
    (t.courses || []).forEach(c => {
      const code = String(c.code || '').toUpperCase().trim();
      if (isPlaceholder(code)) {
        const actual = resolvePlaceholder(c);
        if (actual) resolved.push(actual);
      } else {
        keep.push(c);
      }
    });
    t.courses = keep;
    t.totalCredits = keep.reduce((s, cc) => s + (cc.credits || 0), 0);
  });

  // Pass 2: Distribute resolved courses into earliest semesters with room
  // Spread core/gen-ed across the first ~6 semesters so students take them early
  for (const course of resolved) {
    let placed = false;
    for (const t of terms) {
      if (t.totalCredits + course.credits <= maxCredits) {
        t.courses.push(course);
        t.totalCredits += course.credits;
        placed = true;
        break;
      }
    }
    // If no term has room under the cap, add to the least-loaded term
    if (!placed) {
      const lightest = terms.reduce((a, b) => a.totalCredits <= b.totalCredits ? a : b);
      lightest.courses.push(course);
      lightest.totalCredits += course.credits;
    }
  }

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
    requirementChecklist: (() => {
      // Collect all course codes in the plan for requirement validation
      const allCodes = new Set();
      terms.forEach(t => (t.courses || []).forEach(c => allCodes.add(String(c.code || '').toUpperCase().trim())));

      // Build a set of which core areas are satisfied by courses in the plan
      const coreMap = (coreCodeMap && coreCodeMap.courses) || {};
      const satisfiedCores = new Set();
      allCodes.forEach(code => {
        const cores = coreMap[code];
        if (cores) cores.forEach(c => satisfiedCores.add(c));
      });

      // Map core area codes to keywords that might appear in checklist items
      const coreKeywords = {
        'MTH':  /\b(math|mathematical|calculus|statistics)\b/i,
        'NSC':  /\b(natural science|science|lab|biology|chemistry|physics)\b/i,
        'OCO':  /\b(oral comm|communication|speech)\b/i,
        'WCO':  /\b(written comm|composition|writing)\b/i,
        'WEM':  /\b(writing emphasis)\b/i,
        'HUM':  /\b(humanities)\b/i,
        'SSC':  /\b(social science)\b/i,
        'HT':   /\b(historical traditions|history)\b/i,
        'LT':   /\b(literary traditions|literature)\b/i,
        'RT':   /\b(religious traditions|religion)\b/i,
        'FAR':  /\b(fine arts?)\b/i,
        'CA':   /\b(cultural awareness)\b/i,
        'GA':   /\b(global awareness)\b/i,
        'CSV':  /\b(citizenship|social values)\b/i,
      };

      return (raw.requirementChecklist || []).map(item => {
        const itemText = String(item.item || '').trim();
        let status = normalizeChecklistStatus(String(item.status || '').trim());
        let notes  = String(item.notes || '').trim();
        const combined = itemText + ' ' + notes;

        // If a TCU Core-related item is flagged as unmet, check if courses
        // in the plan actually satisfy that core area
        if (status !== 'Met' && /\b(core|gen.?ed|general education|tcu core)\b/i.test(combined)) {
          // Check each core area — if the checklist item mentions it and it's satisfied, override
          for (const [coreCode, pattern] of Object.entries(coreKeywords)) {
            if (pattern.test(combined) && satisfiedCores.has(coreCode)) {
              status = 'Met';
              break;
            }
          }
          // If the item generically says "TCU Core" without specifying an area,
          // check if most core areas are covered
          if (status !== 'Met' && !/math|science|comm|hum|history|liter|relig|arts?|cultur|global|citizen/i.test(combined)) {
            const totalAreas = Object.keys(coreKeywords).length;
            if (satisfiedCores.size >= totalAreas * 0.7) {
              status = 'Met';
              notes = notes || `${satisfiedCores.size} of ${totalAreas} core areas satisfied by scheduled courses`;
            }
          }
        }

        return { item: itemText, status, notes };
      });
    })(),
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
  const conversationHistory = Array.isArray(body.conversationHistory) ? body.conversationHistory : [];

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
  const coreCodeMapFile = path.join(process.cwd(), 'data', 'core_code_map.json');
  const coreCodeMap = loadJson(coreCodeMapFile) || { courses: {} };

  // Build prompt
  const transferEquivFile = path.join(process.cwd(), 'data', 'transfer_equivalencies.json');
  const transferEquiv = loadJson(transferEquivFile) || { core: [], nonCore: [] };

  const systemPrompt = buildSystemPrompt(profile, kineRules, genedRules, careerDefaults, transferEquiv);

  // Build conversation context from recent history
  const historyBlock = conversationHistory.length > 0
    ? `\nRECENT CONVERSATION (for context — do NOT repeat information already discussed):\n` +
      conversationHistory
        .filter(m => m.content && m.content.trim())
        .map(m => `${m.role === 'user' ? 'Student' : 'FrogNav'}: ${String(m.content).slice(0, 300)}`)
        .join('\n') +
      '\n'
    : '';

  const userMessage = lastPlan
    ? `The student has an existing degree plan. Update or build on it based on their message — do NOT start from scratch. Preserve all existing terms and courses unless the student explicitly asks to change them.\n\nEXISTING PLAN:\n${JSON.stringify(lastPlan)}${historyBlock}\nSTUDENT MESSAGE: ${message || action}`
    : JSON.stringify({ action, profile, message });

  // Call Claude with timeout
  const controller  = new AbortController();
  const abortTimer  = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [2000, 4000, 8000]; // exponential backoff
  let response;
  let payload;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
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

    // If overloaded (529) and we have retries left, wait and try again
    if (response.status === 529 && attempt < MAX_RETRIES - 1) {
      console.log(`[plan] 529 Overloaded — retrying in ${RETRY_DELAYS[attempt]}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
      continue;
    }

    break;
  }
  clearTimeout(abortTimer);

  // Parse Claude response
  payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = payload?.error?.message || 'Upstream model request failed.';
    if (response.status === 529) {
      return err(res, 529, 'The AI is currently busy. Please wait a moment and try again.', 'FROGNAV_OVERLOADED');
    }
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
    // The AI responded conversationally instead of JSON — treat it as a chat message
    // rather than showing a broken fallback plan with empty terms
    return res.status(200).json({
      type: 'chat',
      message: cleaned,
      nextSteps: [
        { label: 'Try again', prompt: 'Please try building my plan again.' },
        { label: 'Make changes to my schedule', prompt: 'I\'d like to make some changes to my current schedule. What are my options?' },
      ],
    });
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

  return res.status(200).json(normalizePlan(rawPlan, profile, careerDefaults, coreCodeMap));
};
