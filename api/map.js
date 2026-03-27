'use strict';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL         = process.env.FROGNAV_MODEL || 'claude-sonnet-4-20250514';
const TIMEOUT_MS    = 55_000;

const SYSTEM_PROMPT = `You are a visual map generator for TCU Kinesiology degree plans. Given a student's degree plan, generate ONLY a Mermaid.js flowchart diagram using the 'graph TD' (top-down) format. Rules:
- Each semester is a row flowing left to right
- Courses within a semester are grouped
- Use arrows to show prerequisite relationships where known
- Color completed courses green using :::completed
- Color current/planned courses purple using :::planned
- Keep course labels short: course code only (e.g., KINE 30623)
- Add classDef at the end: classDef completed fill:#22c55e,stroke:#16a34a,color:#fff; classDef planned fill:#7e4dff,stroke:#6c3de0,color:#fff;
Return ONLY the Mermaid syntax, no explanation, no code fences.`;

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
    return err(res, 405, 'Use POST /api/map with JSON body.', 'FROGNAV_METHOD_NOT_ALLOWED');
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return err(res, 503, 'ANTHROPIC_API_KEY is not configured.', 'FROGNAV_CONFIG');
  }

  const body = readBody(req);
  if (!body || !body.lastPlan || typeof body.lastPlan !== 'object') {
    return err(res, 400, 'Expected JSON body: { profile, lastPlan }.', 'FROGNAV_BAD_REQUEST');
  }

  const profile  = body.profile && typeof body.profile === 'object' ? body.profile : {};
  const lastPlan = body.lastPlan;

  // Build a concise plan summary for the AI
  const completedCourses = (profile.completedCourses || '').trim();
  const termsSummary = (lastPlan.terms || []).map(t => {
    const courses = (t.courses || []).map(c => c.code || 'TBD').join(', ');
    return `${t.term}: ${courses}`;
  }).join('\n');

  const userMessage = `Generate a Mermaid flowchart for this degree plan.

Student: ${profile.majorProgram || 'Kinesiology'} major${profile.minorProgram ? `, ${profile.minorProgram} minor` : ''}
Completed courses: ${completedCourses || 'None listed'}

PLAN BY SEMESTER:
${termsSummary}`;

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
          max_tokens: 4096,
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

  const content = payload?.content?.[0]?.text;
  if (!content || typeof content !== 'string') {
    return err(res, 502, 'AI response had no text content.', 'FROGNAV_BAD_PAYLOAD');
  }

  // Strip any accidental code fences
  const mermaidSyntax = content.trim()
    .replace(/^```(?:mermaid)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  return res.status(200).json({
    type: 'map',
    mermaid: mermaidSyntax,
  });
};
