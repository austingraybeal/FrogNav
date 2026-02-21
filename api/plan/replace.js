const { normalizeCode, normalizeLevel, getLevelContext, isKnownCourseOrPlaceholder, resolveBucket } = require('../lib/catalogRules');

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ code: 'FROGNAV_METHOD_NOT_ALLOWED', detail: 'Method not allowed.' });
  const body = readBody(req);
  if (!body?.planJson || !body?.fromCode || !body?.toCode) {
    return res.status(400).json({ code: 'FROGNAV_BAD_REQUEST', detail: 'Expected { planJson, fromCode, toCode, profile? }.' });
  }

  const profile = body.profile || body.planJson.profileEcho || {};
  profile.level = normalizeLevel(profile.level);
  const levelContext = getLevelContext(profile.level);
  const fromCode = normalizeCode(body.fromCode);
  const toCode = normalizeCode(body.toCode);
  const warnings = [];

  if (!isKnownCourseOrPlaceholder(fromCode, levelContext)) return res.status(400).json({ code: 'FROGNAV_UNKNOWN_FROM', detail: `Unknown fromCode: ${fromCode}` });
  if (!isKnownCourseOrPlaceholder(toCode, levelContext)) return res.status(400).json({ code: 'FROGNAV_UNKNOWN_TO', detail: `Unknown toCode: ${toCode}` });

  const fromBucket = resolveBucket(fromCode, profile, levelContext);
  const toBucket = resolveBucket(toCode, profile, levelContext);
  if (!fromBucket || !toBucket) {
    return res.status(400).json({ code: 'FROGNAV_BUCKET_MISSING', detail: 'Unable to map one or both courses to requirement buckets.' });
  }
  if (fromBucket.id !== toBucket.id) {
    return res.status(400).json({ code: 'FROGNAV_BUCKET_MISMATCH', detail: `Bucket mismatch: ${fromBucket.id} cannot be replaced with ${toBucket.id}.` });
  }

  const updatedPlan = structuredClone(body.planJson);
  let replaced = false;
  (updatedPlan.terms || []).forEach((term) => {
    (term.courses || []).forEach((course) => {
      if (normalizeCode(course.code) === fromCode) {
        course.code = toCode;
        course.bucket = toBucket.id;
        replaced = true;
      }
    });
  });

  if (!replaced) warnings.push(`Course ${fromCode} was not present in plan terms.`);

  return res.status(200).json({ planJson: updatedPlan, warnings });
};
