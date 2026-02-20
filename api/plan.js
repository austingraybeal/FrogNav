const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

const RESPONSE_SCHEMA = {
  name: "frognav_response",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["reply", "planJson"],
    properties: {
      reply: { type: "string" },
      planJson: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["major", "startTerm", "targetGraduation", "creditsPerTerm", "terms"],
            properties: {
              major: { type: "string" },
              startTerm: { type: "string" },
              targetGraduation: { type: "string" },
              creditsPerTerm: { type: "string" },
              terms: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["name", "courses", "credits"],
                  properties: {
                    name: { type: "string" },
                    courses: { type: "array", items: { type: "string" } },
                    credits: { type: "string" },
                  },
                },
              },
            },
          },
        ],
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

function isValidMessages(messages) {
  return (
    Array.isArray(messages) &&
    messages.every((message) =>
      message &&
      (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string" &&
      message.content.trim().length > 0
    )
  );
}

function detectFriendlyError(status, payload) {
  const code = payload?.error?.code || "";
  const text = String(payload?.error?.message || "").toLowerCase();

  if (status === 429 || code === "rate_limit_exceeded" || text.includes("rate limit")) {
    return "FrogNav is receiving heavy traffic right now. Please wait a moment and retry.";
  }

  if (code === "insufficient_quota" || text.includes("quota") || text.includes("billing")) {
    return "FrogNav's planning service is temporarily unavailable due to usage limits. Please try again later.";
  }

  if (status === 401 || code === "invalid_api_key") {
    return "FrogNav is not configured correctly right now. Please contact support and try again later.";
  }

  return "FrogNav couldn't generate a response right now. Please try again.";
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
  if (!body || typeof body.profile !== "object" || !isValidMessages(body.messages)) {
    res.status(400).json({ error: "Invalid request. Expected JSON: { profile, messages, lastPlan?, action? }." });
    return;
  }

  const action = typeof body.action === "string" ? body.action : "chat";
  const context = [
    `Action: ${action}`,
    `Student profile: ${JSON.stringify(body.profile, null, 2)}`,
    `Last plan context: ${JSON.stringify(body.lastPlan || null, null, 2)}`,
  ].join("\n\n");

  const systemPrompt = `You are FrogNav, a TCU kinesiology AI planning advisor.

Rules:
- Keep responses concise and advising-focused.
- If action is "build", provide a full multi-term plan and set planJson with structured terms.
- If action is "minor", "honors", or "compare", treat it as a follow-up update using last plan context if present.
- For compare, explain differences between Movement Science and Health and Fitness, and include a suggested revised term structure in planJson if possible.
- Avoid ASCII art tables.
- If reliable details are missing, note assumptions clearly.
- Never reveal internal implementation details.`;

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
          json_schema: RESPONSE_SCHEMA,
        },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "system", content: context },
          ...body.messages.map((item) => ({ role: item.role, content: item.content })),
        ],
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      res.status(502).json({ error: detectFriendlyError(response.status, payload) });
      return;
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      res.status(502).json({ error: "FrogNav returned an empty response. Please try again." });
      return;
    }

    const parsed = JSON.parse(content);
    res.status(200).json({
      reply: parsed.reply,
      planJson: parsed.planJson,
    });
  } catch {
    res.status(500).json({ error: "FrogNav hit a temporary error. Please try again in a moment." });
  }
};
