'use strict';

const fs   = require('fs');
const path = require('path');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// Allow MODEL to be overridden via environment variable for easy upgrades
const MODEL = process.env.FROGNAV_MODEL || 'claude-sonnet-4-20250514';

const VALID_ACTIONS = new Set(['build', 'add_minor', 'honors', 'compare', 'chat']);

const REQUIRED_DISCLAIMER =
  'This is planning assistance only and does not replace official advising or the TCU degree audit system.';

// ── JSON Schema sent to OpenAI structured output ─────────────────────────────
const PLAN_SCHEMA = {
  name: 'frognav_plan',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'planSummary',
      'terms',
      'requirementChecklist',
      'policyWarnings',
      'adjustmentOptions',
      'disclaimer',
      'assumptions',
      'questions',
      'profileEcho',
    ],
    properties: {
      planSummary: { type: 'string' },
      terms: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['term', 'courses', 'totalCredits'],
          properties: {
            term: { type: 'string' },
            courses: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['code', 'title', 'credits', 'notes'],
                properties: {
                  code:    { type: 'string' },
                  title:   { type: 'string' },
                  credits: { type: 'number' },
                  notes:   { type: 'string' },
                },
              },
            },
            totalCredits: { type: 'number' },
          },
        },
      },
      requirementChecklist: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['item', 'status', 'notes'],
          properties: {
            item:   { type: 'string' },
            status: {
              type: 'string',
              enum: ['Met', 'In Progress', 'Planned', 'Needs Review'],
            },
            notes: { type: 'string' },
          },
        },
      },
      policyWarnings:    { type: 'array', items: { type: 'string' } },
      adjustmentOptions: { type: 'array', items: { type: 'string' } },
      disclaimer:        { type: 'string' },
      assumptions:       { type: 'array', items: { type: 'string' } },
      questions:         { type: 'array', items: { type: 'string' } },
      profileEcho: {
        type: 'object',
        additionalProperties: false,
        required: [
          'level', 'major', 'minor', 'honors',
          'startTerm', 'targetGraduation', 'creditsPerTerm',
        ],
        properties: {
          level:            { type: 'string', enum: ['undergrad', 'grad'] },
          major:            { type: 'string' },
          minor:            { type: 'string' },
          honors:           { type: 'boolean' },
          startTerm:        { type: 'string' },
          targetGraduation: { type: 'string' },
          creditsPerTerm:   { type: 'number' },
        },
      },
    },
  },
};

// ── Catalog rules — lazy singleton ───────────────────────────────────────────
// FIX #1: path was './lib/catalogRules' but this file lives in api/ — must go up one level
function requireCatalogRules() {
  return require('../lib/catalogRules');
}

// ── Request body parser ───────────────────────────────────────────────────────
function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try   { return JSON.parse(req.body); }
    catch { return null; }
  }
  return null;
}

// ── Response helpers ──────────────────────────────────────────────────────────
function sendJsonError(res, status, detail, code) {
  return res.status(status).json({ code, detail });
}

function sendInternalError(res, error, where) {
  const stackTop =
    typeof error?.stack === 'string' ? error.stack.split('\n')[0] : undefined;
  return res.status(500).json({
    code:   'FROGNAV_INTERNAL',
    detail: error?.message || 'Unknown backend error',
    where,
    stackTop,
  });
}

// ── Numeric helper ────────────────────────────────────────────────────────────
const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// ── Term sequence builder ─────────────────────────────────────────────────────
function parseStartTerm(startTermRaw) {
  const match = String(startTermRaw || 'Fall 2026')
    .trim()
    .match(/^(Fall|Spring|Summer)\s+(\d{4})$/i);
  if (!match) return { season: 'Fall', year: 2026 };
  return {
    season: match[1][0].toUpperCase() + match[1].slice(1).toLowerCase(),
    year:   Number(match[2]),
  };
}

function buildDefaultEightTerms(startTermRaw) {
  const parsed = parseStartTerm(startTermRaw);
  const terms  = [];
  let year   = parsed.year;
  let season = parsed.season === 'Spring' ? 'Spring' : 'Fall';

  while (terms.length < 8) {
    terms.push(`${season} ${year}`);
    season = season === 'Fall' ? 'Spring' : 'Fall';
    if (season === 'Fall') year += 1;
  }

  return terms;
}

// ── Required data files — now level-aware ────────────────────────────────────
// FIX #3: Previously checked ALL files before parsing the body, so level was always unknown.
// Now accepts level so only the relevant files are required.
function requiredDataFiles(level) {
  const files = {
    kineRules: path.join(process.cwd(), 'data', 'kine_rules_undergrad.json'),
  };

  if (level === 'grad') {
    files.gradCatalog = path.join(process.cwd(), 'data', 'grad', 'catalog.json');
  } else {
    // Default: undergrad
    files.undergradCatalog = path.join(process.cwd(), 'data', 'undergrad', 'catalog.json');
    files.genedRules       = path.join(process.cwd(), 'data', 'undergrad', 'gened_rules.json');
  }

  return files;
}

function findMissingFiles(level) {
  return Object.entries(requiredDataFiles(level))
    .filter(([, filePath]) => !fs.existsSync(filePath))
    .map(([key]) => key);
}

// ── Course normalizer ─────────────────────────────────────────────────────────
function normalizeCourse(course) {
  const { normalizeCode } = requireCatalogRules();
  const normalizedCode    = normalizeCode(course?.code || '');
  const bucket            = course?.bucket || null;
  return {
    code:    normalizedCode,
    title:   String(course?.title   || '').trim(),
    credits: toNumber(course?.credits, 0),
    notes:   String(course?.notes   || '').trim(),
    bucket:  bucket ? String(bucket) : null,
  };
}

// ── Plan shape normalizer ─────────────────────────────────────────────────────
function normalizePlanShape(plan, safeProfile) {
  const { normalizeLevel } = requireCatalogRules();
  const level        = normalizeLevel(safeProfile.level);
  const defaultTerms = buildDefaultEightTerms(safeProfile.startTerm);
  const generatedTerms = Array.isArray(plan?.terms) ? plan.terms : [];

  const termMap = new Map();
  generatedTerms.forEach(term => {
    const key = String(term?.term || '').trim();
    if (!key) return;
    const normalizedCourses = Array.isArray(term.courses)
      ? term.courses.map(normalizeCourse)
      : [];
    const calcCredits = normalizedCourses.reduce(
      (sum, course) => sum + toNumber(course.credits, 0), 0
    );
    termMap.set(key, {
      term:         key,
      courses:      normalizedCourses,
      totalCredits: toNumber(term?.totalCredits, calcCredits),
    });
  });

  // Keep default 8 terms in order, then append any extras the AI added
  const orderedTerms = defaultTerms.map(termLabel =>
    termMap.get(termLabel) || { term: termLabel, courses: [], totalCredits: 0 }
  );
  generatedTerms.forEach(term => {
    const key = String(term?.term || '').trim();
    if (!key || defaultTerms.includes(key)) return;
    orderedTerms.push(termMap.get(key));
  });

  // Guarantee required disclaimer suffix
  const disclaimer = String(plan?.disclaimer || '').trim();
  const finalDisclaimer = disclaimer.endsWith(REQUIRED_DISCLAIMER)
    ? disclaimer
    : `${disclaimer ? `${disclaimer} ` : ''}${REQUIRED_DISCLAIMER}`.trim();

  // Guarantee required assumption lines are always present
  const assumptions = Array.isArray(plan?.assumptions) ? [...plan.assumptions] : [];
  const requiredAssumptions = [
    'Term availability not provided; verify in TCU Class Search.',
    'Prerequisite sequencing assumed based on standard progression.',
  ];
  requiredAssumptions.forEach(line => {
    if (!assumptions.includes(line)) assumptions.push(line);
  });

  const profileEcho = {
    level,
    major:  String(plan?.profileEcho?.major || safeProfile.majorProgram || '').trim(),
    minor:  String(plan?.profileEcho?.minor || safeProfile.minorProgram || '').trim(),
    honors: Boolean(
      typeof plan?.profileEcho?.honors === 'boolean'
        ? plan.profileEcho.honors
        : safeProfile.honorsCollege
    ),
    startTerm:
      String(plan?.profileEcho?.startTerm || safeProfile.startTerm || 'Fall 2026').trim(),
    targetGraduation:
      String(plan?.profileEcho?.targetGraduation || safeProfile.targetGraduation || '').trim(),
    creditsPerTerm: toNumber(
      plan?.profileEcho?.creditsPerTerm,
      toNumber(safeProfile.creditsPerTerm, 15)
    ),
  };

  return {
    planSummary: String(plan?.planSummary || '').trim(),
    terms:       orderedTerms,
    requirementChecklist: Array.isArray(plan?.requirementChecklist)
      ? plan.requirementChecklist.map(item => ({
          item:   String(item?.item   || '').trim(),
          status: ['Met', 'In Progress', 'Planned', 'Needs Review'].includes(item?.status)
            ? item.status
            : 'Needs Review',
          notes: String(item?.notes || '').trim(),
        }))
      : [],
    policyWarnings:    (plan?.policyWarnings    || []).map(i => String(i || '')),
    adjustmentOptions: (plan?.adjustmentOptions || []).map(i => String(i || '')),
    disclaimer:        finalDisclaimer,
    assumptions,
    questions: (plan?.questions || []).map(i => String(i || '')),
    profileEcho,
  };
}

// ── Plan constraint enforcer ──────────────────────────────────────────────────
function enforcePlanConstraints(plan, safeProfile, levelContext) {
  const {
    normalizeCode,
    isKnownCourseOrPlaceholder,
    isExplicitUndergradPlaceholder,
    resolveBucket,
    majorRules,
  } = requireCatalogRules();

  const warnings = [];

  // Surface any catalog loading warning from getLevelContext
  if (levelContext.catalogWarning) warnings.push(levelContext.catalogWarning);

  // FIX: Warn clearly if the chosen major isn't recognized — prevents silent empty plans
  const major = majorRules(safeProfile, levelContext);
  if (!major && safeProfile.majorProgram) {
    warnings.push(
      `Major "${safeProfile.majorProgram}" was not recognized for ${levelContext.level} plans. ` +
      `Please check your Student Profile and select a valid major.`
    );
  }

  const filteredTerms = (plan.terms || []).map(term => {
    const allowedCourses = [];

    (term.courses || []).forEach(course => {
      const code = normalizeCode(course.code);

      if (!code) {
        warnings.push('Removed unknown/non-catalog course: (blank).');
        return;
      }

      if (!isKnownCourseOrPlaceholder(code, levelContext)) {
        warnings.push(`Removed unknown/non-catalog course: ${course.code || '(blank)'}.`);
        return;
      }

      if (levelContext.level === 'grad' && isExplicitUndergradPlaceholder(code, levelContext)) {
        warnings.push(`Removed placeholder not valid for graduate plans: ${code}.`);
        return;
      }

      const bucket = resolveBucket(code, safeProfile, levelContext);
      if (
        !bucket &&
        !(levelContext.level === 'undergrad' && isExplicitUndergradPlaceholder(code, levelContext))
      ) {
        warnings.push(`Removed course not mapped to major/minor/gen-ed bucket: ${code}.`);
        return;
      }

      const bucketId    = bucket?.id    || 'GENED-PLACEHOLDER';
      const bucketLabel = bucket?.label || 'GenEd Placeholder';
      allowedCourses.push({
        ...course,
        code,
        bucket: bucketId,
        notes:  [course.notes, bucketLabel].filter(Boolean).join(' | '),
      });
    });

    const totalCredits = allowedCourses.reduce(
      (sum, item) => sum + toNumber(item.credits, 0), 0
    );
    return { ...term, courses: allowedCourses, totalCredits };
  });

  return {
    ...plan,
    terms:          filteredTerms,
    policyWarnings: [...(plan.policyWarnings || []), ...warnings],
  };
}

// ── Fallback plan (returned when catalog loading fails) ───────────────────────
// FIX #8: Removed the rogue `warnings` key that was not in the schema
function fallbackPlan(profile, warning) {
  const safeLevel = profile?.level === 'grad' ? 'grad' : 'undergrad';
  return {
    planSummary:
      'Fallback mode plan generated. Core catalog validation is temporarily unavailable.',
    terms: buildDefaultEightTerms(profile?.startTerm).map(term => ({
      term,
      courses:      [],
      totalCredits: 0,
    })),
    requirementChecklist: [
      {
        item:   'Advising review required',
        status: 'Needs Review',
        notes:  'Fallback mode returned a lightweight plan.',
      },
    ],
    policyWarnings: [
      warning,
      'Fallback mode is active. Validate all requirements with official advising.',
    ],
    adjustmentOptions: [
      'Retry after backend catalog data is healthy.',
      'Run /api/health to verify runtime files and configuration.',
    ],
    disclaimer: REQUIRED_DISCLAIMER,
    assumptions: [
      'Term availability not provided; verify in TCU Class Search.',
      'Prerequisite sequencing assumed based on standard progression.',
    ],
    questions: [
      'Do you want a targeted term-by-term draft once catalog validation recovers?',
    ],
    profileEcho: {
      level:            safeLevel,
      major:            String(profile?.majorProgram   || '').trim(),
      minor:            String(profile?.minorProgram   || '').trim(),
      honors:           Boolean(profile?.honorsCollege),
      startTerm:        String(profile?.startTerm       || 'Fall 2026').trim(),
      targetGraduation: String(profile?.targetGraduation || '').trim(),
      creditsPerTerm:   toNumber(profile?.creditsPerTerm, 15),
    },
    // NOTE: No extra keys here — schema uses additionalProperties: false
  };
}

// ── System prompt builder ─────────────────────────────────────────────────────
function buildSystemPrompt(safeProfile, levelContext) {
  // FIX #4 & #5: All kineRules accesses are null-guarded — kineRules is null for grad
  const kineRules  = levelContext.kineRules  || {};
  const genedRules = levelContext.genedRules || { buckets: [] };

  const majorKeys = Object.keys(kineRules.majors  || {}).join(', ') || '(none)';
  const minorKeys = Object.keys(kineRules.minors  || {}).join(', ') || '(none)';
  const policyLines = (kineRules.policies || []).map(line => `- ${line}`).join('\n') || '(none)';
  const genedPlaceholders = (genedRules.buckets || [])
    .map(b => b.placeholder)
    .join(' | ') || 'none';

  // FIX #6: Build allowedSubjects map per major so AI only generates valid course subjects
  const subjectMapLines = Object.entries(kineRules.majors || {})
    .map(([name, rules]) =>
      `  - ${name}: ${(rules.allowedSubjects || []).join(', ') || '(any)'}`
    )
    .join('\n');

  // FIX #7: Include summerOptional instruction so AI respects the student's preference
  const summerInstruction = safeProfile.summerOptional
    ? 'Summer terms are OPTIONAL — only include a Summer term if the student cannot fit all required courses into Fall/Spring terms alone.'
    : 'Summer terms MAY be used freely alongside Fall and Spring terms.';

  return `You are FrogNav GPT, a TCU Kinesiology planning advisor for ${safeProfile.level} students.
Return ONLY valid JSON matching the requested schema. No markdown, no commentary, no extra keys.

Academic level: ${safeProfile.level}
Major program: ${safeProfile.majorProgram || '(not set)'}
Minor program: ${safeProfile.minorProgram || '(none)'}
Honors College: ${safeProfile.honorsCollege ? 'Yes — include Honors sections where available' : 'No'}
Start term: ${safeProfile.startTerm || 'Fall 2026'}
Target graduation: ${safeProfile.targetGraduation || '(not set)'}
Credits per term: ${safeProfile.creditsPerTerm || 15}
Summer optional: ${summerInstruction}

Allowed major keys (use these exactly): ${majorKeys}
Allowed minor keys (use these exactly): ${minorKeys}
Gen-ed placeholders (undergrad only — use these codes verbatim): ${genedPlaceholders}

Allowed course subjects per major (ONLY generate courses from these subject codes for each major):
${subjectMapLines || '  (no subject restrictions for this level)'}

Policy rules (reflect in plans, warnings, and checklist where applicable):
${policyLines}

Required assumption lines (include these two exactly, verbatim):
- Term availability not provided; verify in TCU Class Search.
- Prerequisite sequencing assumed based on standard progression.

Disclaimer field must end exactly with:
${REQUIRED_DISCLAIMER}`;
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  try {
    // ── Method guard ───────────────────────────────────────────────────────────
    if (req.method !== 'POST') {
      return sendJsonError(
        res, 405,
        'Use POST /api/plan with JSON body.',
        'FROGNAV_METHOD_NOT_ALLOWED'
      );
    }

    // ── API key guard ──────────────────────────────────────────────────────────
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({
        code:   'FROGNAV_CONFIG',
        detail: 'ANTHROPIC_API_KEY is not configured on this deployment.',
      });
    }

    // ── Parse body FIRST — we need level before checking files ─────────────────
    // FIX #3: Body must be parsed before findMissingFiles() so we know the level
    const body = readBody(req);
    if (!body || typeof body.profile !== 'object') {
      return sendJsonError(
        res, 400,
        'Expected JSON body: { action, profile, lastPlan?, message? }.',
        'FROGNAV_BAD_REQUEST'
      );
    }

    const { normalizeLevel, getLevelContext } = requireCatalogRules();

    // ── FIX #2: Deep-clone profile — NEVER mutate the caller's object ──────────
    const safeProfile = JSON.parse(JSON.stringify(body.profile || {}));
    safeProfile.level = normalizeLevel(safeProfile.level);

    // ── Check required data files for THIS student's level ─────────────────────
    const missing = findMissingFiles(safeProfile.level);
    if (missing.length) {
      return res.status(503).json({ code: 'FROGNAV_DATA_MISSING', missing });
    }

    const action  = VALID_ACTIONS.has(body.action) ? body.action : 'chat';
    const message = typeof body.message === 'string' ? body.message : '';
    const lastPlan =
      body.lastPlan && typeof body.lastPlan === 'object' ? body.lastPlan : null;

    // ── Load catalog rules ─────────────────────────────────────────────────────
    let levelContext;
    try {
      levelContext = getLevelContext(safeProfile.level);
    } catch (catalogError) {
      return res.status(200).json(
        fallbackPlan(
          safeProfile,
          `Catalog loading failed: ${catalogError.message || 'unknown error'}`
        )
      );
    }

    // ── Build system prompt ────────────────────────────────────────────────────
    const systemPrompt = buildSystemPrompt(safeProfile, levelContext);

    // ── Call OpenAI ────────────────────────────────────────────────────────────
    // Abort after 25 seconds to avoid Vercel's 30s timeout hanging silently
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 25_000);

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
    messages: [
      {
        role:    'user',
        content: JSON.stringify({ action, profile: safeProfile, lastPlan, message }),
      },
    ],
  }),
});
    } catch (fetchError) {
      clearTimeout(abortTimer);
      const isTimeout = fetchError?.name === 'AbortError';
      return sendJsonError(
        res,
        isTimeout ? 504 : 502,
        isTimeout
          ? 'Request to AI model timed out. Please try again.'
          : `Network error reaching AI model: ${fetchError.message}`,
        isTimeout ? 'FROGNAV_TIMEOUT' : 'FROGNAV_NETWORK_ERROR'
      );
    }
    clearTimeout(abortTimer);

    // ── Parse OpenAI response ──────────────────────────────────────────────────
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const backendMessage =
        payload?.error?.message ||
        payload?.error?.code    ||
        'Upstream model request failed.';
      return sendJsonError(
        res,
        response.status,
        String(backendMessage).slice(0, 240),
        'FROGNAV_API_ERROR'
      );
    }

    const content = payload?.content?.[0]?.text;
    if (!content || typeof content !== 'string') {
      return sendJsonError(
        res, 502,
        'AI response did not include message content.',
        'FROGNAV_BAD_PAYLOAD'
      );
    }

    // ── Parse, normalize, and constrain the plan ───────────────────────────────
    let parsedPlan;
    try {
      parsedPlan = JSON.parse(content);
    } catch (parseError) {
      return sendInternalError(res, parseError, 'parse-openai-json');
    }

    const plan        = normalizePlanShape(parsedPlan, safeProfile);
    const constrained = enforcePlanConstraints(plan, safeProfile, levelContext);

    return res.status(200).json(constrained);

  } catch (error) {
    return sendInternalError(res, error, 'handler');
  }
};
