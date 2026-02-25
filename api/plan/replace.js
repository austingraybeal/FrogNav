'use strict';

const {
  normalizeCode,
  normalizeLevel,
  getLevelContext,
  isKnownCourseOrPlaceholder,
  resolveBucket,
} = require('../lib/catalogRules');

// ── Request body parser ───────────────────────────────────────────────────────
function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try   { return JSON.parse(req.body); }
    catch { return null; }
  }
  return null;
}

// ── Safe deep-clone — works on Node 14+ ──────────────────────────────────────
// FIX #4: structuredClone() was used directly — only available in Node 17+
// JSON round-trip is safe here because planJson only contains serializable data
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {

  // ── Method guard ─────────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({
      code:   'FROGNAV_METHOD_NOT_ALLOWED',
      detail: 'Method not allowed.',
    });
  }

  // ── Body validation ───────────────────────────────────────────────────────────
  const body = readBody(req);
  if (!body?.planJson || !body?.fromCode || !body?.toCode) {
    return res.status(400).json({
      code:   'FROGNAV_BAD_REQUEST',
      detail: 'Expected { planJson, fromCode, toCode, profile? }.',
    });
  }

  // ── FIX #1: Deep-clone profile — NEVER mutate the caller's object ─────────────
  // body.profile is preferred; fall back to profileEcho embedded in the plan
  const rawProfile  = body.profile || body.planJson?.profileEcho || {};
  const safeProfile = deepClone(rawProfile);
  safeProfile.level = normalizeLevel(safeProfile.level);

  // ── Load catalog rules safely ─────────────────────────────────────────────────
  // FIX #3: getLevelContext was not wrapped — catalog failure produced an unhandled 500
  let levelContext;
  try {
    levelContext = getLevelContext(safeProfile.level);
  } catch (err) {
    console.error('[replace] getLevelContext failed:', err);
    return res.status(500).json({
      code:   'FROGNAV_RULES_UNAVAILABLE',
      detail: 'Catalog rules could not be loaded. Please try again later.',
    });
  }

  // ── Normalize course codes ────────────────────────────────────────────────────
  const fromCode = normalizeCode(body.fromCode);
  const toCode   = normalizeCode(body.toCode);
  const warnings = [];

  // ── Validate both codes exist in catalog ─────────────────────────────────────
  if (!isKnownCourseOrPlaceholder(fromCode, levelContext)) {
    return res.status(400).json({
      code:   'FROGNAV_UNKNOWN_FROM',
      detail: `Unknown fromCode: ${fromCode}. This course was not found in the ${safeProfile.level} catalog.`,
    });
  }

  if (!isKnownCourseOrPlaceholder(toCode, levelContext)) {
    return res.status(400).json({
      code:   'FROGNAV_UNKNOWN_TO',
      detail: `Unknown toCode: ${toCode}. This course was not found in the ${safeProfile.level} catalog.`,
    });
  }

  // ── Resolve requirement buckets for both courses ──────────────────────────────
  // FIX #5: resolveBucket now uses safeProfile instead of the mutated original
  const fromBucket = resolveBucket(fromCode, safeProfile, levelContext);
  const toBucket   = resolveBucket(toCode,   safeProfile, levelContext);

  if (!fromBucket || !toBucket) {
    return res.status(400).json({
      code:   'FROGNAV_BUCKET_MISSING',
      detail: 'Unable to map one or both courses to requirement buckets. ' +
              'Verify the courses belong to your selected major or minor.',
    });
  }

  // Bucket IDs must match — can't replace a core course with a minor elective etc.
  if (fromBucket.id !== toBucket.id) {
    return res.status(400).json({
      code:   'FROGNAV_BUCKET_MISMATCH',
      detail: `Bucket mismatch: "${fromBucket.label}" cannot be replaced with "${toBucket.label}". ` +
              `Both courses must belong to the same requirement bucket.`,
    });
  }

  // ── Look up the replacement course's full details ─────────────────────────────
  // FIX #2: Previously only swapped code + bucket — title and credits stayed from old course
  const replacementCourse = levelContext.catalogIndex.get(toCode);

  // ── Clone the plan before modifying it ───────────────────────────────────────
  const updatedPlan = deepClone(body.planJson);
  let replaced = false;

  (updatedPlan.terms || []).forEach(term => {
    (term.courses || []).forEach(course => {
      if (normalizeCode(course.code) === fromCode) {

        if (replacementCourse) {
          // ✅ Full replacement — update code, title, credits, and bucket together
          course.code    = toCode;
          course.title   = replacementCourse.title   || course.title;
          course.credits = replacementCourse.credits ?? course.credits;
          course.bucket  = toBucket.id;
          course.notes   = [
            course.notes?.replace(/\s*\|.*$/, '').trim(), // strip old bucket suffix
            toBucket.label,
          ].filter(Boolean).join(' | ');
        } else {
          // Replacement course found in catalog checks but not in index
          // (can happen with placeholders) — swap code and bucket only
          course.code   = toCode;
          course.bucket = toBucket.id;
          warnings.push(
            `${toCode} was validated but not found in the catalog index — ` +
            `title and credits may be inaccurate. Please verify with an advisor.`
          );
        }

        replaced = true;
      }
    });
  });

  // ── Warn if the course wasn't actually in the plan ────────────────────────────
  if (!replaced) {
    warnings.push(
      `Course ${fromCode} was not found in any term of this plan. ` +
      `No changes were made.`
    );
  }

  // ── Recalculate totalCredits for every term ───────────────────────────────────
  // Ensures term credit totals stay accurate after the swap
  (updatedPlan.terms || []).forEach(term => {
    term.totalCredits = (term.courses || []).reduce(
      (sum, c) => sum + (Number(c.credits) || 0), 0
    );
  });

  return res.status(200).json({ planJson: updatedPlan, warnings });
};
