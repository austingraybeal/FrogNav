'use strict';
const { normalizeLevel, getLevelContext, searchCatalog } = require('../../lib/catalogRules'); // ← fixed path

module.exports = async function handler(req, res) {
  // ── Method guard ────────────────────────────────────────────────────────────
  if (req.method !== 'GET') {
    return res.status(405).json({
      code: 'FROGNAV_METHOD_NOT_ALLOWED',
      detail: 'Method not allowed.',
    });
  }

  // ── Parse + validate query params ───────────────────────────────────────────
  const q = String(req.query?.q || '').trim();

  // Early return for empty or too-short query
  if (!q || q.length < 2) {
    return res.status(200).json({ results: [] });
  }

  const rawLevel = String(req.query?.level || 'undergrad').trim();
  const level    = normalizeLevel(rawLevel);

  // Clamp limit between 1 and 50 to prevent abuse
  const limit = Math.min(Math.max(1, Number(req.query?.limit) || 12), 50);

  // Warn in logs if an unrecognized level was sent (silently coerced)
  if (!['undergrad', 'grad'].includes(rawLevel.toLowerCase())) {
    console.warn(`[search] Unknown level param "${rawLevel}", defaulted to "${level}"`);
  }

  // ── Load catalog rules safely ────────────────────────────────────────────────
  let levelContext;
  try {
    levelContext = getLevelContext(level);
  } catch (err) {
    console.error('[search] getLevelContext error:', err);
    return res.status(500).json({
      code: 'FROGNAV_RULES_UNAVAILABLE',
      detail: 'Catalog rules could not be loaded. Please try again later.',
      results: [],
    });
  }

  // ── Run search ───────────────────────────────────────────────────────────────
  let results;
  try {
    results = searchCatalog(q, levelContext, limit);
  } catch (err) {
    console.error('[search] searchCatalog error:', err);
    return res.status(500).json({
      code: 'FROGNAV_SEARCH_ERROR',
      detail: 'Search failed. Please try again.',
      results: [],
    });
  }

  // ── Respond with cache headers (catalog rarely changes) ─────────────────────
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
  return res.status(200).json({ results });
};
