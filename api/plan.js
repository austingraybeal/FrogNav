const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

const VALID_ACTIONS = new Set(["build", "add_minor", "honors", "compare", "chat"]);
const REQUIRED_DISCLAIMER =
  "This is planning assistance only and does not replace official advising or the TCU degree audit system.";

const PLAN_SCHEMA = {
  name: "frognav_plan",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "planSummary",
      "terms",
      "requirementChecklist",
      "policyWarnings",
      "adjustmentOptions",
      "disclaimer",
      "assumptions",
      "questions",
      "profileEcho",
    ],
    properties: {
      planSummary: { type: "string" },
      terms: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["term", "courses", "totalCredits"],
          properties: {
            term: { type: "string" },
            courses: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["code", "title", "credits", "notes"],
                properties: {
                  code: { type: "string" },
                  title: { type: "string" },
                  credits: { type: "number" },
                  notes: { type: "string" },
                },
              },
            },
            totalCredits: { type: "number" },
          },
        },
      },
      requirementChecklist: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["item", "status", "notes"],
          properties: {
            item: { type: "string" },
            status: {
              type: "string",
              enum: ["Met", "In Progress", "Planned", "Needs Review"],
            },
            notes: { type: "string" },
          },
        },
      },
      policyWarnings: { type: "array", items: { type: "string" } },
      adjustmentOptions: { type: "array", items: { type: "string" } },
      disclaimer: { type: "string" },
      assumptions: { type: "array", items: { type: "string" } },
      questions: { type: "array", items: { type: "string" } },
      profileEcho: {
        type: "object",
        additionalProperties: false,
        required: ["major", "minor", "honors", "startTerm", "targetGraduation", "creditsPerTerm"],
        properties: {
          major: { type: "string" },
          minor: { type: "string" },
          honors: { type: "boolean" },
          startTerm: { type: "string" },
          targetGraduation: { type: "string" },
          creditsPerTerm: { type: "number" },
        },
      },
    },
  },
};

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return null;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseStartTerm(startTermRaw) {
  const match = String(startTermRaw || "Fall 2026").trim().match(/^(Fall|Spring|Summer)\s+(\d{4})$/i);
  if (!match) return { season: "Fall", year: 2026 };
  return {
    season: match[1][0].toUpperCase() + match[1].slice(1).toLowerCase(),
    year: Number(match[2]),
  };
}

function buildDefaultEightTerms(startTermRaw) {
  const parsed = parseStartTerm(startTermRaw);
  const terms = [];
  let year = parsed.year;
  let season = parsed.season === "Spring" ? "Spring" : "Fall";

  while (terms.length < 8) {
    if (season === "Fall" || season === "Spring") {
      terms.push(`${season} ${year}`);
      season = season === "Fall" ? "Spring" : "Fall";
      if (season === "Fall") year += 1;
    } else {
      season = "Fall";
    }
  }

  return terms;
}

function normalizeCourse(course) {
  return {
    code: String(course?.code || "").trim(),
    title: String(course?.title || "").trim(),
    credits: toNumber(course?.credits, 0),
    notes: String(course?.notes || "").trim(),
  };
}

function normalizePlanShape(plan, profile) {
  const safeProfile = profile || {};
  const defaultTerms = buildDefaultEightTerms(safeProfile.startTerm);
  const generatedTerms = Array.isArray(plan?.terms) ? plan.terms : [];

  const termMap = new Map();
  generatedTerms.forEach((term) => {
    const key = String(term?.term || "").trim();
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
    const key = String(term?.term || "").trim();
    if (!key || defaultTerms.includes(key)) return;
    orderedTerms.push(termMap.get(key));
  });

  const disclaimer = String(plan?.disclaimer || "").trim();
  const finalDisclaimer = disclaimer.endsWith(REQUIRED_DISCLAIMER)
    ? disclaimer
    : `${disclaimer ? `${disclaimer} ` : ""}${REQUIRED_DISCLAIMER}`.trim();

  const assumptions = Array.isArray(plan?.assumptions) ? [...plan.assumptions] : [];
  const requiredAssumptions = [
    "Term availability not provided; verify in TCU Class Search.",
    "Prerequisite sequencing assumed based on standard progression.",
  ];
  requiredAssumptions.forEach((requiredLine) => {
    if (!assumptions.includes(requiredLine)) assumptions.push(requiredLine);
  });

  const profileEcho = {
    major: String(plan?.profileEcho?.major || safeProfile.majorProgram || "").trim(),
    minor: String(plan?.profileEcho?.minor || safeProfile.minorProgram || "").trim(),
    honors: Boolean(
      typeof plan?.profileEcho?.honors === "boolean" ? plan.profileEcho.honors : safeProfile.honorsCollege
    ),
    startTerm: String(plan?.profileEcho?.startTerm || safeProfile.startTerm || "Fall 2026").trim(),
    targetGraduation: String(plan?.profileEcho?.targetGraduation || safeProfile.targetGraduation || "").trim(),
    creditsPerTerm: toNumber(plan?.profileEcho?.creditsPerTerm, toNumber(safeProfile.creditsPerTerm, 15)),
  };

  return {
    planSummary: String(plan?.planSummary || "").trim(),
    terms: orderedTerms,
    requirementChecklist: Array.isArray(plan?.requirementChecklist)
      ? plan.requirementChecklist.map((item) => ({
          item: String(item?.item || "").trim(),
          status: ["Met", "In Progress", "Planned", "Needs Review"].includes(item?.status)
            ? item.status
            : "Needs Review",
          notes: String(item?.notes || "").trim(),
        }))
      : [],
    policyWarnings: Array.isArray(plan?.policyWarnings) ? plan.policyWarnings.map((item) => String(item || "")) : [],
    adjustmentOptions: Array.isArray(plan?.adjustmentOptions)
      ? plan.adjustmentOptions.map((item) => String(item || ""))
      : [],
    disclaimer: finalDisclaimer,
    assumptions,
    questions: Array.isArray(plan?.questions) ? plan.questions.map((item) => String(item || "")) : [],
    profileEcho,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "FrogNav is temporarily unavailable. Please try again soon." });
  }

  const body = readBody(req);
  if (!body || typeof body.profile !== "object") {
    return res.status(400).json({ error: "Invalid request. Expected JSON: { action, profile, lastPlan?, message? }." });
  }

  const action = VALID_ACTIONS.has(body.action) ? body.action : "chat";
  const message = typeof body.message === "string" ? body.message : "";
  const profile = body.profile || {};
  const lastPlan = body.lastPlan && typeof body.lastPlan === "object" ? body.lastPlan : null;

  const systemPrompt = `You are FrogNav GPT, a TCU kinesiology planning advisor.
Return ONLY valid JSON matching the requested schema. No markdown, no commentary, no extra keys.

Policy rules (must be reflected in plans/warnings/checklist where applicable):
- No P/NC for KINE core/foundation/emphasis/associated reqs; C- minimum
- GPA rules: 2.5 for Movement Science & Health/Fitness core+foundation+emphasis; 2.75 overall for PE and PE+S&C to remain
- After 54 hours need 2.5 cumulative GPA for 30000+ KINE/HLTH
- All KINE/HLTH major coursework at TCU
- Transfer limits (4 courses post-matriculation; science at 4-year)

Required assumptions lines (include exactly):
- Term availability not provided; verify in TCU Class Search.
- Prerequisite sequencing assumed based on standard progression.

Disclaimer must end exactly with:
${REQUIRED_DISCLAIMER}

Planning behavior:
- Use action to decide behavior: build, add_minor, honors, compare, or chat.
- For follow-up actions, modify or compare against lastPlan when provided.
- Always include an 8-term Fall/Spring plan in terms by default. If summer is used, keep the 8 Fall/Spring terms and append summer terms if needed.
- Keep checklist and warnings specific to the selected program/profile.
- profileEcho must mirror the current profile inputs and inferred values.`;

  const userContext = JSON.stringify({ action, profile, lastPlan, message });

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        response_format: { type: "json_schema", json_schema: PLAN_SCHEMA },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContext },
        ],
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const backendMessage = payload?.error?.message || payload?.error?.code || "Upstream model request failed.";
      return res.status(response.status).json({ error: String(backendMessage) });
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      return res.status(502).json({ error: "Upstream model returned empty content." });
    }

    const plan = normalizePlanShape(JSON.parse(content), profile);
    return res.status(200).json(plan);
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Unexpected planning service error." });
  }
};
