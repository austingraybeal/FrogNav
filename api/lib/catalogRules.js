const fs = require('fs');
const path = require('path');

const root = process.cwd();

function loadJson(relativePath, options = {}) {
  let kineRulesUndergrad = null;
try {
  kineRulesUndergrad = JSON.parse(
    fs.readFileSync(path.join(root, 'data', 'kine_rules_undergrad.json'), 'utf8')
  );
} catch (err) {
  console.warn('[catalogRules] kine_rules_undergrad.json not found or invalid — kineRules will be null.');
}


function normalizeLevel(level) {
  return String(level || 'undergrad').trim().toLowerCase() === 'grad' ? 'grad' : 'undergrad';
}

const LEVEL_PATHS = Object.freeze({
  undergrad: path.join(root, 'data', 'undergrad'),
  grad:      path.join(root, 'data', 'grad'),
});


const levelDataCache = new Map();

function getCachedLevelData(level) {
  const normalizedLevel = normalizeLevel(level);
  if (levelDataCache.has(normalizedLevel)) return levelDataCache.get(normalizedLevel);

  const paths = LEVEL_PATHS[normalizedLevel];
  const loaded = {
    catalogPath: paths.catalogPath,
    catalogIndex: loadJson(paths.catalogIndexPath, { optional: true, fallback: {} }),
    kineRules: loadJson(paths.kineRulesPath),
    genedRules: paths.genedRulesPath
      ? loadJson(paths.genedRulesPath, { optional: true, fallback: { buckets: [] } })
      : { buckets: [] },
  };

  levelDataCache.set(normalizedLevel, loaded);
  return loaded;
}

function getLevelContext(level) {
  const normalizedLevel = normalizeLevel(level);
  const data = getCachedLevelData(normalizedLevel);
  const catalogWarning = fs.existsSync(data.catalogPath)
    ? null
    : `Catalog index unavailable for ${normalizedLevel} at runtime; using limited validation.`;

  return {
    level: normalizedLevel,
    catalogIndex: data.catalogIndex,
    catalogWarning,
    kineRules: data.kineRules,
    genedRules: data.genedRules,
    genedPlaceholders: new Set((data.genedRules.buckets || []).map((bucket) => normalizeCode(bucket.placeholder))),
  };
}

function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function isExplicitUndergradPlaceholder(code, levelContext) {
  if (levelContext.level !== 'undergrad') return false;
  return levelContext.genedPlaceholders.has(normalizeCode(code));
}

function isKnownCourseOrPlaceholder(code, levelContext) {
  const normalized = normalizeCode(code);
  return Boolean(levelContext.catalogIndex[normalized] || isExplicitUndergradPlaceholder(normalized, levelContext));
}

function getSubject(code) {
  return normalizeCode(code).split(' ')[0] || '';
}

function majorRules(profile, levelContext) {
  return levelContext.kineRules.majors?.[String(profile?.majorProgram || '').trim()] || null;
}

function minorRules(profile, levelContext) {
  const minor = String(profile?.minorProgram || '').trim();
  if (!minor) return null;
  return levelContext.kineRules.minors?.[minor] || null;
}

function resolveBucket(code, profile, levelContext) {
  const normalized = normalizeCode(code);

  const genedBucket = (levelContext.genedRules.buckets || []).find(
    (bucket) => normalizeCode(bucket.placeholder) === normalized
  );
  if (genedBucket) return { id: genedBucket.id, label: `GenEd: ${genedBucket.name}`, kind: 'gened' };

  const major = majorRules(profile, levelContext);
  const minor = minorRules(profile, levelContext);
  const subject = getSubject(normalized);

  if (major && Array.isArray(major.allowedSubjects) && major.allowedSubjects.includes(subject)) {
    const bucket = major.buckets?.[0];
    return {
      id: bucket?.id || `${String(profile?.majorProgram || 'MAJOR').toUpperCase()}-GENERAL`,
      label: `Major: ${bucket?.name || 'Major Requirement'}`,
      kind: 'major',
    };
  }

  if (minor && Array.isArray(minor.allowedSubjects) && minor.allowedSubjects.includes(subject)) {
    const bucket = minor.buckets?.[0];
    return {
      id: bucket?.id || `${String(profile?.minorProgram || 'MINOR').toUpperCase()}-GENERAL`,
      label: `Minor: ${bucket?.name || 'Minor Requirement'}`,
      kind: 'minor',
    };
  }

  return null;
}

function searchCatalog(query, levelContext, limit = 12) {
  const q = String(query || '').trim().toUpperCase();
  if (!q) return [];

  const results = [];
  Object.entries(levelContext.catalogIndex).forEach(([code, course]) => {
    if (code.includes(q) || String(course.description || '').toUpperCase().includes(q)) {
      results.push({
        code,
        description: String(course.description || '').slice(0, 140),
      });
    }
  });

const query = q.toLowerCase().trim();
return catalog
  .filter(course => {
    const code  = (course.code  || '').toLowerCase();
    const title = (course.title || '').toLowerCase();
    return code.includes(query) || title.includes(query);
  })
  .sort((a, b) => {
    const aCode  = (a.code  || '').toLowerCase();
    const bCode  = (b.code  || '').toLowerCase();
    const aStart = aCode.startsWith(query) ? 0 : 1;
    const bStart = bCode.startsWith(query) ? 0 : 1;
    return aStart - bStart;
  })
  .slice(0, limit);


module.exports = {
  normalizeCode,
  normalizeLevel,
  getLevelContext,
  isKnownCourseOrPlaceholder,
  isExplicitUndergradPlaceholder,
  resolveBucket,
  searchCatalog,
};
