const fs = require('fs');
const path = require('path');

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';

const VALID_ACTIONS = new Set(['build', 'add_minor', 'honors', 'compare', 'chat']);
const REQUIRED_DISCLAIMER =
  'This is planning assistance only and does not replace official advising or the TCU degree audit system.';

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
                  code: { type: 'string' },
                  title: { type: 'string' },
                  credits: { type: 'number' },
                  notes: { type: 'string' },
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
            item: { type: 'string' },
            status: {
              type: 'string',
              enum: ['Met', 'In Progress', 'Planned', 'Needs Review'],
            },
            notes: { type: 'string' },
          },
        },
      },
      policyWarnings: { type: 'array', items: { type: 'string' } },
      adjustmentOptions: { type: 'array', items: { type: 'string' } },
      disclaimer: { type: 'string' },
      assumptions: { type: 'array', items: { type: 'string' } },
      questions: { type: 'array', items: { type: 'string' } },
      profileEcho: {
        type: 'object',
        additionalProperties: false,
        required: ['level', 'major', 'minor', 'honors', 'startTerm', 'targetGraduation', 'creditsPerTerm'],
        properties: {
          level: { type: 'string', enum: ['undergrad', 'grad'] },
          major: { type: 'string' },
          minor: { type: 'string' },
          honors: { type: 'boolean' },
          startTerm: { type: 'string' },
          targetGraduation: { type: 'string' },
          creditsPerTerm: { type: 'number' },
        },
      },
    },
  },
};

function requireCatalogRules() {
  return require('./lib/catalogRules');
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return null;
}

function sendJsonError(res, status, detail, code) {
  return res.status(status).json({ code, detail });
}

function sendInternalError(res, error, where) {
  const stackTop = typeof error?.stack === 'string' ? error.stack.split('\n')[0] : undefined;
  return res.status(500).json({
    code: 'FROGNAV_INTERNAL',
    detail: error?.message || 'Unknown backend error',
    where,
    stackTop,
  });
}

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function parseStartTerm(startTermRaw) {
  const match = String(startTermRaw || 'Fall 2026').trim().match(/^(Fall|Spring|Summer)\s+(\d{4})$/i);
  if (!match) return { season: 'Fall', year: 2026 };
  return {
    season: match[1][0].toUpperCase() + match[1].slice(1).toLowerCase(),
    year: Number(match[2]),
  };
}

function buildDefaultEightTerms(startTermRaw) {
  const parsed = parseStartTerm(startTermRaw);
  const terms = [];
  let year = parsed.year;
  let season = parsed.season === 'Spring' ? 'Spring' : 'Fall';

  while (terms.length < 8) {
    terms.push(`${season} ${year}`);
    season = season === 'Fall' ? 'Spring' : 'Fall';
    if (season === 'Fall') year += 1;
  }

  return terms;
}

function requiredDataFiles() {
  return {
    undergradCsv: path.join(process.cwd(), 'data', 'tcu_courses_undergrad.csv'),
    gradCsv: path.join(process.cwd(), 'data', 'tcu_courses_grad.csv'),
    undergradPdf: path.join(process.cwd(), 'data', 'tcu_undergrad_catalog.pdf'),
    gradPdf: path.join(process.cwd(), 'data', 'tcu_grad_catalog.pdf'),
    kineRules: path.join(process.cwd(), 'data', 'kine_rules_undergrad.json'),
    genedRules: path.join(process.cwd(), 'data', 'gened_rules_undergrad.json'),
  };
}

function findMissingFiles() {
  return Object.entries(requiredDataFiles())
    .filter(([, filePath]) => !fs.existsSync(filePath))
    .map(([key]) => key);
}

function normalizeCourse(course) {
  const { normalizeCode } = requireCatalogRules();
  const normalizedCode = normalizeCode(course?.code || '');
  const bucket = course?.bucket || null;
  return {
    code: normalizedCode,
    title: String(course?.title || '').trim(),
    credits: toNumber(course?.credits, 0),
    notes: String(course?.notes || '').trim(),
    bucket: bucket ? String(bucket) : null,
  };
}

function normalizePlanShape(plan, profile) {
  const { normalizeLevel } = requireCatalogRules();
  const safeProfile = profile || {};
  const level = normalizeLevel(safeProfile.level);
  const defaultTerms = buildDefaultEightTerms(safeProfile.startTerm);
  const generatedTerms = Array.isArray(plan?.terms) ? plan.terms : [];

  const termMap = new Map();
  generatedTerms.forEach((term) => {
    const key = String(term?.term || '').trim();
    if (!key) return;
    const normalizedCourses = Array.isArray(term.courses) ? term.courses.map(normalizeCourse) : [];
    const calcCredits = normalizedCourses.reduce((sum, course) => sum + toNumber(course.credits, 0), 0);
    termMap.set(key, {
      term: key,
      courses: normalizedCourses,
      totalCredits: toNumber(term?.totalCredits, calcCredits),
    });
  });

  const orderedTerms = defaultTerms.map((termLabel) =>
    termMap.get(termLabel) || {
      term: termLabel,
      courses: [],
      totalCredits: 0,
    }
  );

  generatedTerms.forEach((term) => {
    const key = String(term?.term || '').trim();
    if (!key || defaultTerms.includes(key)) return;
    orderedTerms.push(termMap.get(key));
  });

  const disclaimer = String(plan?.disclaimer || '').trim();
  const finalDisclaimer = disclaimer.endsWith(REQUIRED_DISCLAIMER)
    ? disclaimer
    : `${disclaimer ? `${disclaimer} ` : ''}${REQUIRED_DISCLAIMER}`.trim();

  const assumptions = Array.isArray(plan?.assumptions) ? [...plan.assumptions] : [];
  const requiredAssumptions = [
    'Term availability not provided; verify in TCU Class Search.',
    'Prerequisite sequencing assumed based on standard progression.',
  ];
  requiredAssumptions.forEach((requiredLine) => {
    if (!assumptions.includes(requiredLine)) assumptions.push(requiredLine);
  });

  const profileEcho = {
    level,
    major: String(plan?.profileEcho?.major || safeProfile.majorProgram || '').trim(),
    minor: String(plan?.profileEcho?.minor || safeProfile.minorProgram || '').trim(),
    honors: Boolean(typeof plan?.profileEcho?.honors === 'boolean' ? plan.profileEcho.honors : safeProfile.honorsCollege),
    startTerm: String(plan?.profileEcho?.startTerm || safeProfile.startTerm || 'Fall 2026').trim(),
    targetGraduation: String(plan?.profileEcho?.targetGraduation || safeProfile.targetGraduation || '').trim(),
    creditsPerTerm: toNumber(plan?.profileEcho?.creditsPerTerm, toNumber(safeProfile.creditsPerTerm, 15)),
  };

  return {
    planSummary: String(plan?.planSummary || '').trim(),
    terms: orderedTerms,
    requirementChecklist: Array.isArray(plan?.requirementChecklist)
      ? plan.requirementChecklist.map((item) => ({
          item: String(item?.item || '').trim(),
          status: ['Met', 'In Progress', 'Planned', 'Needs Review'].includes(item?.status) ? item.status : 'Needs Review',
          notes: String(item?.notes || '').trim(),
        }))
      : [],
    policyWarnings: Array.isArray(plan?.policyWarnings) ? plan.policyWarnings.map((item) => String(item || '')) : [],
    adjustmentOptions: Array.isArray(plan?.adjustmentOptions) ? plan.adjustmentOptions.map((item) => String(item || '')) : [],
    disclaimer: finalDisclaimer,
    assumptions,
    questions: Array.isArray(plan?.questions) ? plan.questions.map((item) => String(item || '')) : [],
    profileEcho,
  };
}

function enforcePlanConstraints(plan, profile, levelContext) {
  const { normalizeCode, isKnownCourseOrPlaceholder, isExplicitUndergradPlaceholder, resolveBucket } = requireCatalogRules();
  const warnings = [];
  if (levelContext.catalogWarning) warnings.push(levelContext.catalogWarning);

  const filteredTerms = (plan.terms || []).map((term) => {
    const allowedCourses = [];
    (term.courses || []).forEach((course) => {
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

      const bucket = resolveBucket(code, profile, levelContext);
      if (!bucket && !(levelContext.level === 'undergrad' && isExplicitUndergradPlaceholder(code, levelContext))) {
        warnings.push(`Removed course not mapped to major/minor/gen-ed bucket: ${code}.`);
        return;
      }

      const bucketId = bucket?.id || 'GENED-PLACEHOLDER';
      const bucketLabel = bucket?.label || 'GenEd Placeholder';
      allowedCourses.push({ ...course, code, bucket: bucketId, notes: [course.notes, bucketLabel].filter(Boolean).join(' | ') });
    });
    const totalCredits = allowedCourses.reduce((sum, item) => sum + toNumber(item.credits, 0), 0);
    return { ...term, courses: allowedCourses, totalCredits };
  });

  return {
    ...plan,
    terms: filteredTerms,
    policyWarnings: [...(plan.policyWarnings || []), ...warnings],
  };
}

function fallbackPlan(profile, warning) {
  const safeLevel = profile?.level === 'grad' ? 'grad' : 'undergrad';
  return {
    planSummary: 'Fallback mode plan generated. Core catalog validation is temporarily unavailable.',
    terms: buildDefaultEightTerms(profile?.startTerm).map((term) => ({ term, courses: [], totalCredits: 0 })),
    requirementChecklist: [
      { item: 'Advising review required', status: 'Needs Review', notes: 'Fallback mode returned a lightweight plan.' },
    ],
    policyWarnings: [warning, 'Fallback mode is active. Validate all requirements with official advising.'],
    adjustmentOptions: ['Retry after backend catalog data is healthy.', 'Run /api/health to verify runtime files and configuration.'],
    disclaimer: REQUIRED_DISCLAIMER,
    assumptions: [
      'Term availability not provided; verify in TCU Class Search.',
      'Prerequisite sequencing assumed based on standard progression.',
    ],
    questions: ['Do you want a targeted term-by-term draft once catalog validation recovers?'],
    profileEcho: {
      level: safeLevel,
      major: String(profile?.majorProgram || '').trim(),
      minor: String(profile?.minorProgram || '').trim(),
      honors: Boolean(profile?.honorsCollege),
      startTerm: String(profile?.startTerm || 'Fall 2026').trim(),
      targetGraduation: String(profile?.targetGraduation || '').trim(),
      creditsPerTerm: toNumber(profile?.creditsPerTerm, 15),
    },
    warnings: ['fallback mode is active'],
  };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return sendJsonError(res, 405, 'Use POST /api/plan with JSON body.', 'FROGNAV_METHOD_NOT_ALLOWED');
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ code: 'FROGNAV_CONFIG', detail: 'OPENAI_API_KEY missing' });
    }

    const missing = findMissingFiles();
    if (missing.length) {
      return res.status(503).json({ code: 'FROGNAV_DATA_MISSING', missing });
    }

    const body = readBody(req);
    if (!body || typeof body.profile !== 'object') {
      return sendJsonError(res, 400, 'Expected JSON: { action, profile, lastPlan?, message? }.', 'FROGNAV_BAD_REQUEST');
    }

    const action = VALID_ACTIONS.has(body.action) ? body.action : 'chat';
    const message = typeof body.message === 'string' ? body.message : '';
    const profile = body.profile || {};
    const { normalizeLevel, getLevelContext } = requireCatalogRules();

    profile.level = normalizeLevel(profile.level);
    const lastPlan = body.lastPlan && typeof body.lastPlan === 'object' ? body.lastPlan : null;

    let levelContext;
    try {
      levelContext = getLevelContext(profile.level);
    } catch (catalogError) {
      return res.status(200).json(fallbackPlan(profile, `Catalog loading failed: ${catalogError.message || 'unknown error'}`));
    }

    const systemPrompt = `You are FrogNav GPT, a TCU kinesiology planning advisor for ${profile.level} students.
Return ONLY valid JSON matching the requested schema. No markdown, no commentary, no extra keys.

Academic level: ${profile.level}
Allowed major keys: ${Object.keys(levelContext.kineRules.majors || {}).join(', ')}
Allowed minor keys: ${Object.keys(levelContext.kineRules.minors || {}).join(', ') || '(none)'}
Gen-ed placeholders (undergrad only): ${(levelContext.genedRules.buckets || []).map((bucket) => bucket.placeholder).join(' || ') || 'none'}

Policy rules (must be reflected in plans/warnings/checklist where applicable):
${(levelContext.kineRules.policies || []).map((line) => `- ${line}`).join('\n')}
Required assumptions lines (include exactly):
- Term availability not provided; verify in TCU Class Search.
- Prerequisite sequencing assumed based on standard progression.

Disclaimer must end exactly with:
${REQUIRED_DISCLAIMER}`;

    const response = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        response_format: { type: 'json_schema', json_schema: PLAN_SCHEMA },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify({ action, profile, lastPlan, message }) },
        ],
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const backendMessage = payload?.error?.message || payload?.error?.code || 'Upstream model request failed.';
      return sendJsonError(res, response.status, String(backendMessage).slice(0, 240), 'FROGNAV_OPENAI_ERROR');
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      return sendJsonError(res, 502, 'Response did not include message content text.', 'FROGNAV_OPENAI_BAD_PAYLOAD');
    }

    let parsedPlan;
    try {
      parsedPlan = JSON.parse(content);
    } catch (error) {
      return sendInternalError(res, error, 'parse-openai-json');
    }

    const plan = normalizePlanShape(parsedPlan, profile);
    const constrained = enforcePlanConstraints(plan, profile, levelContext);
    return res.status(200).json(constrained);
  } catch (error) {
    return sendInternalError(res, error, 'handler');
  }
};
