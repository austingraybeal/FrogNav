'use strict';
const fs   = require('fs');
const path = require('path');

const root = process.cwd();

const LEVEL_PATHS = Object.freeze({
  undergrad: Object.freeze({
    catalogPath:      path.join(root, 'data', 'undergrad', 'catalog.json'),
    catalogIndexPath: path.join(root, 'data', 'undergrad', 'catalog.json'),
    kineRulesPath:    path.join(root, 'data', 'kine_rules_undergrad.json'),
    genedRulesPath:   path.join(root, 'data', 'undergrad', 'gened_rules.json'),
  }),
  grad: Object.freeze({
    catalogPath:      path.join(root, 'data', 'grad', 'catalog.json'),
    catalogIndexPath: path.join(root, 'data', 'grad', 'catalog.json'),
    kineRulesPath:    null,
    genedRulesPath:   null,
  }),
});

function loadJson(filePath, options = {}) {
  const { optional = false, fallback = null } = options;
  if (!filePath) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (!optional) console.warn(`[catalogRules] Could not load "${filePath}": ${err.message}`);
    return fallback;
  }
}

function normalizeLevel(level) {
  return String(level || 'undergrad').trim().toLowerCase() === 'grad' ? 'grad' : 'undergrad';
}

function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function getSubject(code) {
  return normalizeCode(code).split(' ')[0] || '';
}

// ── Level data cache ──────────────────────────────────────────────────────────
const levelDataCache = new Map();

function getCachedLevelData(level) {
  const lvl = normalizeLevel(level);
  if (levelDataCache.has(lvl)) return levelDataCache.get(lvl);

  const paths = LEVEL_PATHS[lvl];
  const rawCatalog = loadJson(paths.catalogIndexPath, { optional: true, fallback: {} });

  const catalogIndex = new Map();
  const courseList = Array.isArray(rawCatalog.courses)
    ? rawCatalog.courses
    : Object.entries(rawCatalog).map(([code, course]) => ({ code, ...course }));
  courseList.forEach(course => {
    if (course.code) catalogIndex.set(normalizeCode(course.code), course);
  });

  const loaded = {
    catalogPath: paths.catalogPath,
    catalogIndex,
    kineRules: paths.kineRulesPath
      ? loadJson(paths.kineRulesPath, { optional: true, fallback: null })
      : null,
    genedRules: paths.genedRulesPath
      ? loadJson(paths.genedRulesPath, { optional: true, fallback: { buckets: [] } })
      : { buckets: [] },
  };
  levelDataCache.set(lvl, loaded);
  return loaded;
}

function getLevelContext(level) {
  const lvl = normalizeLevel(level);
  const data = getCachedLevelData(lvl);
  const catalogWarning = fs.existsSync(data.catalogPath)
    ? null
    : `Catalog unavailable for "${lvl}" — validation will be limited.`;
  if (catalogWarning) console.warn(`[catalogRules] ${catalogWarning}`);

  return {
    level: lvl,
    catalogIndex: data.catalogIndex,
    catalogWarning,
    kineRules: data.kineRules,
    genedRules: data.genedRules,
    genedPlaceholders: new Set(
      (data.genedRules.buckets || []).map(b => normalizeCode(b.placeholder))
    ),
  };
}

// ── Placeholder checks ────────────────────────────────────────────────────────
function isExplicitUndergradPlaceholder(code, levelContext) {
  if (levelContext.level !== 'undergrad') return false;
  return levelContext.genedPlaceholders.has(normalizeCode(code));
}

function isKnownCourseOrPlaceholder(code, levelContext) {
  const normalized = normalizeCode(code);
  return (
    levelContext.catalogIndex.has(normalized) ||
    isExplicitUndergradPlaceholder(normalized, levelContext)
  );
}

// ── Rules helpers ─────────────────────────────────────────────────────────────
function majorRules(profile, levelContext) {
  if (!levelContext.kineRules?.majors) return null;
  return levelContext.kineRules.majors[String(profile?.majorProgram || '').trim()] || null;
}

function minorRules(profile, levelContext) {
  const minor = String(profile?.minorProgram || '').trim();
  if (!minor || !levelContext.kineRules?.minors) return null;
  return levelContext.kineRules.minors[minor] || null;
}

// ── resolveBucket (FIXED) ─────────────────────────────────────────────────────
// Previously checked allowedSubjects (which doesn't exist in the JSON).
// Now checks requiredCourses and chooseFrom lists inside each bucket.
function resolveBucket(code, profile, levelContext) {
  const normalized = normalizeCode(code);

  // 1. GenEd placeholder
  const genedBucket = (levelContext.genedRules.buckets || []).find(
    b => normalizeCode(b.placeholder) === normalized
  );
  if (genedBucket) return { id: genedBucket.id, label: `GenEd: ${genedBucket.name}`, kind: 'gened' };

  // 2. Major buckets — search requiredCourses and chooseFrom
  const major = majorRules(profile, levelContext);
  if (major) {
    for (const bucket of (major.buckets || [])) {
      const required = (bucket.requiredCourses || []).map(normalizeCode);
      const choose   = (bucket.chooseFrom || []).map(normalizeCode);
      if (required.includes(normalized) || choose.includes(normalized)) {
        return { id: bucket.id, label: bucket.name || 'Major Requirement', kind: 'major' };
      }
    }
  }

  // 3. Minor buckets — search requiredCourses and chooseFrom
  const minor = minorRules(profile, levelContext);
  if (minor) {
    const required = (minor.requiredCourses || []).map(normalizeCode);
    const elective = (minor.electiveCourses?.chooseFrom || []).map(normalizeCode);
    const choose2  = (minor.chooseFromRequired?.chooseFrom || []).map(normalizeCode);
    if ([...required, ...elective, ...choose2].includes(normalized)) {
      const minorKey = String(profile?.minorProgram || 'Minor');
      return {
        id: `MINOR-${minorKey.toUpperCase().replace(/\s+/g, '-')}`,
        label: `Minor: ${minorKey}`,
        kind: 'minor',
      };
    }
  }

  // 4. Anything in the catalog index is valid as a general elective
  if (levelContext.catalogIndex.has(normalized)) {
    return { id: 'GENED-ELECTIVE', label: 'General Elective / TCU Core', kind: 'elective' };
  }

  return null;
}

// ── searchCatalog ─────────────────────────────────────────────────────────────
function searchCatalog(query, levelContext, limit = 12) {
  const q = String(query || '').trim();
  if (!q) return [];
  const qUpper = q.toUpperCase();
  const qLower = q.toLowerCase();

  const matched = [];
  levelContext.catalogIndex.forEach((course, code) => {
    const title = String(course.title || '').toLowerCase();
    const codeMatch  = code.includes(qUpper);
    const titleMatch = title.includes(qLower);
    if (codeMatch || titleMatch) {
      matched.push({
        code,
        title: course.title || '',
        credits: course.credits ?? null,
        description: String(course.description || '').slice(0, 140),
        _rank: code.startsWith(qUpper) ? 0 : codeMatch ? 1 : 2,
      });
    }
  });

  matched.sort((a, b) => a._rank - b._rank || a.code.localeCompare(b.code));
  return matched.slice(0, limit).map(({ _rank, ...rest }) => rest);
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  normalizeCode,
  normalizeLevel,
  getLevelContext,
  isKnownCourseOrPlaceholder,
  isExplicitUndergradPlaceholder,
  majorRules,
  minorRules,
  resolveBucket,
  searchCatalog,
  getSubject,
};
