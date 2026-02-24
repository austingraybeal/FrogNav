const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');

function loadJson(relativePath, options = {}) {
  const { optional = false, fallback = null } = options;
  const fullPath = path.join(root, relativePath);
  try {
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch (error) {
    if (optional && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function normalizeLevel(level) {
  return String(level || 'undergrad').trim().toLowerCase() === 'grad' ? 'grad' : 'undergrad';
}

const LEVEL_PATHS = {
  undergrad: {
    catalogPath: path.join(root, 'data', 'catalog_index_undergrad.json'),
    catalogIndexPath: 'data/catalog_index_undergrad.json',
    kineRulesPath: 'data/kine_rules_undergrad.json',
    genedRulesPath: 'data/gened_rules_undergrad.json',
  },
  grad: {
    catalogPath: path.join(root, 'data', 'catalog_index_grad.json'),
    catalogIndexPath: 'data/catalog_index_grad.json',
    kineRulesPath: 'data/kine_rules_grad.json',
    genedRulesPath: null,
  },
};

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

  return results.slice(0, Math.max(1, limit));
}

module.exports = {
  normalizeCode,
  normalizeLevel,
  getLevelContext,
  isKnownCourseOrPlaceholder,
  isExplicitUndergradPlaceholder,
  resolveBucket,
  searchCatalog,
};
