const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

const REQUIRED_SYSTEM_MESSAGE = `You are FrogNav, a TCU kinesiology planning assistant.

Return the plan as plain text using these exact section headings in this exact order:
PLAN SUMMARY
8-SEMESTER PLAN TABLE (with credit totals)
REQUIREMENT CHECKLIST
POLICY WARNINGS
ADJUSTMENT OPTIONS (2–3 options)
DISCLAIMER

Strict output rules:
- Do not hallucinate unknown degree requirements.
- If required information is missing and blocks a reliable plan, ask only the minimum clarifying questions needed.
- Always include both of these exact lines in POLICY WARNINGS:
  "Term availability not provided; verify in TCU Class Search."
  "Prerequisite sequencing assumed based on standard progression."
- Always end DISCLAIMER with this exact sentence:
  "This is planning assistance only and does not replace official advising or the TCU degree audit system."
- Keep the tone concise, advising-focused, and transparent about assumptions.`;

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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({ error: "OPENAI_API_KEY is not configured." });
    return;
  }

  const body = readBody(req);
  if (!body || typeof body.intake !== "object" || typeof body.promptText !== "string") {
    res.status(400).json({ error: "Expected JSON body: { intake, promptText }." });
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
        messages: [
          { role: "system", content: REQUIRED_SYSTEM_MESSAGE },
          {
            role: "user",
            content: `Use this intake JSON and generated prompt to create the output.\n\nIntake JSON:\n${JSON.stringify(
              body.intake,
              null,
              2
            )}\n\nGenerated Prompt:\n${body.promptText}`,
          },
        ],
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      const errorMessage = payload?.error?.message || "OpenAI request failed.";
      res.status(502).json({ error: errorMessage });
      return;
    }

    const planText = payload?.choices?.[0]?.message?.content?.trim();
    if (!planText) {
      res.status(502).json({ error: "OpenAI returned an empty response." });
      return;
    }

    res.status(200).json({ planText });
  } catch {
    res.status(500).json({ error: "Unexpected server error while generating plan." });
  }
};
