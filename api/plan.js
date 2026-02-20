const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

const REQUIRED_SYSTEM_MESSAGE = `You are FrogNav, a TCU kinesiology planning assistant.

Return each assistant response as plain text using these exact section headings in this exact order:
PLAN SUMMARY
8-SEMESTER PLAN TABLE (with credit totals)
REQUIREMENT CHECKLIST
POLICY WARNINGS
ADJUSTMENT OPTIONS (2–3 options)
DISCLAIMER

Strict output rules:
- Do not hallucinate unknown degree requirements.
- If required information is missing and blocks a reliable plan, use warnings/notes to request minimal clarification.
- warnings must always include:
  "Term availability not provided; verify in TCU Class Search."
  "Prerequisite sequencing assumed based on standard progression."
- disclaimer must end with exactly:
  "This is planning assistance only and does not replace official advising or the TCU degree audit system."
- Keep the tone concise, advising-focused, and transparent about assumptions.
- Never include stack traces or internal implementation details.`;

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
      const errorMessage = payload?.error?.message;
      if (typeof errorMessage === "string" && errorMessage.toLowerCase().includes("api key")) {
        res.status(502).json({ error: "FrogNav cannot reach the planning service right now. Please retry shortly." });
        return;
      }

      res.status(502).json({ error: "FrogNav couldn't generate a response right now. Please try again." });
      return;
    }

    const reply = payload?.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      res.status(502).json({ error: "FrogNav returned an empty response. Please try again." });
      return;
    }

    res.status(200).json({ reply });
  } catch {
    res.status(500).json({ error: "FrogNav hit a temporary error. Please try again in a moment." });
  }
};
