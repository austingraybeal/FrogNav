const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

const REQUIRED_SYSTEM_MESSAGE = `You are FrogNav, a TCU kinesiology planning assistant.

You must return valid JSON only (no markdown) with this exact shape:
{
  "planSummary": "string",
  "terms": [
    {
      "term": "string",
      "courses": ["string"],
      "credits": 0
    }
  ],
  "requirementChecklist": [
    {
      "item": "string",
      "status": "Met|In Progress|Planned|Needs Review",
      "notes": "string"
    }
  ],
  "warnings": ["string"],
  "adjustmentOptions": ["string"],
  "disclaimer": "string"
}

Strict rules:
- Keep output concise, advising-focused, and transparent about assumptions.
- Do not hallucinate unknown degree requirements.
- If required information is missing and blocks a reliable plan, use warnings/notes to request minimal clarification.
- warnings must always include:
  "Term availability not provided; verify in TCU Class Search."
  "Prerequisite sequencing assumed based on standard progression."
- disclaimer must end with exactly:
  "This is planning assistance only and does not replace official advising or the TCU degree audit system."
- Never include stack traces or internal implementation details.`;

const PLAN_SCHEMA = {
  name: "frognav_plan",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      planSummary: { type: "string" },
      terms: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            term: { type: "string" },
            courses: { type: "array", items: { type: "string" } },
            credits: { type: "number" },
          },
          required: ["term", "courses", "credits"],
        },
      },
      requirementChecklist: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            item: { type: "string" },
            status: { type: "string" },
            notes: { type: "string" },
          },
          required: ["item", "status", "notes"],
        },
      },
      warnings: { type: "array", items: { type: "string" } },
      adjustmentOptions: { type: "array", items: { type: "string" } },
      disclaimer: { type: "string" },
    },
    required: ["planSummary", "terms", "requirementChecklist", "warnings", "adjustmentOptions", "disclaimer"],
  },
  strict: true,
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

function isValidMessages(messages) {
  return (
    Array.isArray(messages) &&
    messages.every(
      (message) =>
        message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim().length > 0
    )
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({ error: "FrogNav is temporarily unavailable. Please try again soon." });
    return;
  }

  const body = readBody(req);
  if (!body || typeof body.intake !== "object" || !isValidMessages(body.messages)) {
    res.status(400).json({ error: "Invalid request. Expected JSON: { intake, messages }." });
    return;
  }

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
        response_format: {
          type: "json_schema",
          json_schema: PLAN_SCHEMA,
        },
        messages: [
          { role: "system", content: REQUIRED_SYSTEM_MESSAGE },
          {
            role: "system",
            content: `Student intake JSON:\n${JSON.stringify(body.intake, null, 2)}`,
          },
          ...body.messages,
        ],
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      res.status(502).json({ error: "FrogNav couldn't generate a response right now. Please try again." });
      return;
    }

    const rawReply = payload?.choices?.[0]?.message?.content?.trim();
    if (!rawReply) {
      res.status(502).json({ error: "FrogNav returned an empty response. Please try again." });
      return;
    }

    let plan;
    try {
      plan = JSON.parse(rawReply);
    } catch {
      res.status(502).json({ error: "FrogNav returned an unreadable plan. Please retry." });
      return;
    }

    res.status(200).json(plan);
  } catch {
    res.status(500).json({ error: "FrogNav hit a temporary error. Please try again in a moment." });
  }
};
