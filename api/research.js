'use strict';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL         = process.env.FROGNAV_MODEL || 'claude-sonnet-4-20250514';
const TIMEOUT_MS    = 55_000;

const SYSTEM_PROMPT = `You are FrogNav's deep research assistant for TCU Kinesiology students. Provide thorough, detailed, well-organized answers to questions about career paths, graduate school requirements, certifications, program comparisons, and academic planning. Be specific with numbers, requirements, and timelines where possible. Structure long answers with clear sections. Always relate your answer back to how it applies to a TCU Kinesiology student.

Return ONLY a raw JSON object — no markdown, no code fences, no commentary.

OUTPUT SCHEMA:
{
  "type": "research",
  "message": "string — your full research response, using markdown formatting for sections/lists/bold",
  "nextSteps": [
    { "label": "string — short button label (max 5 words)", "prompt": "string — full prompt to send" }
  ]
}

CRITICAL: You MUST always return valid JSON matching the schema above. NEVER return plain text outside of JSON.`;

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

// ── Main handler ──────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return err(res, 405, 'Use POST /api/research with JSON body.', 'FROGNAV_METHOD_NOT_ALLOWED');
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return err(res, 503, 'ANTHROPIC_API_KEY is not configured.', 'FROGNAV_CONFIG');
  }

  const body = readBody(req);
  if (!body || typeof body.message !== 'string' || !body.message.trim()) {
    return err(res, 400, 'Expected JSON body: { message, profile?, conversationHistory? }.', 'FROGNAV_BAD_REQUEST');
  }

  const message  = body.message.trim();
  const profile  = body.profile && typeof body.profile === 'object' ? body.profile : {};
  const history  = Array.isArray(body.conversationHistory) ? body.conversationHistory : [];

  // Build profile context for the AI
  const profileContext = [
    profile.level        ? `Level: ${profile.level}` : null,
    profile.majorProgram ? `Major: ${profile.majorProgram}` : null,
    profile.minorProgram ? `Minor: ${profile.minorProgram}` : null,
    profile.careerGoal   ? `Career Goal: ${profile.careerGoal}` : null,
    profile.startTerm    ? `Start Term: ${profile.startTerm}` : null,
  ].filter(Boolean).join('\n');

  const profileBlock = profileContext
    ? `\nSTUDENT PROFILE:\n${profileContext}\n`
    : '';

  const historyBlock = history.length > 0
    ? `\nRECENT CONVERSATION:\n` +
      history
        .filter(m => m.content && m.content.trim())
        .map(m => `${m.role === 'user' ? 'Student' : 'FrogNav'}: ${String(m.content).slice(0, 300)}`)
        .join('\n') +
      '\n'
    : '';

  const userMessage = `${profileBlock}${historyBlock}\nRESEARCH QUESTION: ${message}`;

  // Call Claude
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [2000, 4000, 8000];
  let response;

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
          max_tokens: 16384,
          thinking:   { type: 'enabled', budget_tokens: 10000 },
          system:     SYSTEM_PROMPT,
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

    if (response.status === 529 && attempt < MAX_RETRIES - 1) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
      continue;
    }
    break;
  }
  clearTimeout(abortTimer);

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = payload?.error?.message || 'Upstream model request failed.';
    if (response.status === 529) {
      return err(res, 529, 'The AI is currently busy. Please wait a moment and try again.', 'FROGNAV_OVERLOADED');
    }
    return err(res, response.status, String(msg).slice(0, 240), 'FROGNAV_API_ERROR');
  }

  // Extract only the final text block — skip thinking blocks
  const textBlock = (payload?.content || []).find(b => b.type === 'text');
  const content = textBlock?.text;
  if (!content || typeof content !== 'string') {
    return err(res, 502, 'AI response had no text content.', 'FROGNAV_BAD_PAYLOAD');
  }

  // Strip markdown fences if present
  const cleaned = content.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // If the AI didn't return valid JSON, wrap the raw text as a research response
    return res.status(200).json({
      type: 'research',
      message: cleaned,
      nextSteps: [],
    });
  }

  return res.status(200).json({
    type: 'research',
    message: String(parsed.message || '').trim(),
    nextSteps: Array.isArray(parsed.nextSteps)
      ? parsed.nextSteps.slice(0, 3).map(s => ({
          label: String(s.label || '').trim(),
          prompt: String(s.prompt || '').trim(),
        }))
      : [],
  });
};
