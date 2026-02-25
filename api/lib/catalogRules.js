'use strict';

const fs   = require('fs');
const path = require('path');

// ── Project root ─────────────────────────────────────────────────────────────
// process.cwd() is always the project root in Vercel serverless — never use __dirname here
const root = process.cwd();

// ── Level path definitions ───────────────────────────────────────────────────
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

// ── Generic JSON loader ──────────────────────────────────────────────────────
// optional: true  → returns fallback silently if file is missing
// optional: false → logs a warning if file is missing
function loadJson(filePath, options = {}) {
  const { optional = false, fallback = null } = options;

  if (!filePath) return fallback;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (optional) {
      // Silently return fallback — file may legitimately not exist
    } else {
      console.warn(`[catalogRules] Could not load "${filePath}": ${err.message}`);
    }
    return fallback;
  }
}

// ── Level normalization ──────────────────────────────────────────────────────
function normalizeLevel(level) {
  return String(level || 'undergrad').trim().toLowerCase() === 'grad' ? 'grad' : 'undergrad';
}

// ── Level data cache ─────────────────────────────────────────────────────────
// Caches loaded JSON per level so files are only read once per cold start
const levelDataCache = new Map();

function getCachedLevelData(level) {
  const normalizedLevel = normalizeLevel(level);
  if (levelDataCache.has(normalizedLevel)) return levelDataCache.get(normalizedLevel);

  const paths = LEVEL_PATHS[normalizedLevel];

  // Load catalog — stored as a plain object { [CODE]: { title, credits, description, ... } }
  const rawCatalog = loadJson(paths.catalogIndexPath, { optional: true, fallback: {} });

  // Build a normalised Map for O(1) lookups by course code
  const catalogIndex = new Map();
  Object.entries(rawCatalog).forEach(([code, course]) => {
    catalogIndex.set(normalizeCode(code), course);
  });

  const loaded = {
    catalogPath:  paths.catalogPath,
    catalogIndex,                        // Map<string, course>
    kineRules:    paths.kineRulesPath
      ? loadJson(paths.kineRulesPath, { optional: true, fallback: null })
      : null,
    genedRules:   paths.genedRulesPath
      ? loadJson(paths.genedRulesPath, { optional: true, fallback: { buckets: [] } })
      : { buckets: [] },
  };

  levelDataCache.set(normalizedLevel, loaded);
  return loaded;
}

// ── getLevelContext ───────────────────────────────────────────────────────────
// Public entry point — returns everything callers need about a given level
function getLevelContext(level) {
  const normalizedLevel = normalizeLevel(level);
  const data = getCachedLevelData(normalizedLevel);

  const catalogWarning = fs.existsSync(data.catalogPath)
    ? null
    : `Catalog unavailable for "${normalizedLevel}" at runtime — validation will be limited.`;

  if (catalogWarning) {
    console.warn(`[catalogRules] ${catalogWarning}`);
  }

  return {
    level:            normalizedLevel,
    catalogIndex:     data.catalogIndex,       // Map<normalizedCode, course>
    catalogWarning,
    kineRules:        data.kineRules,          // object | null
    genedRules:       data.genedRules,         // { buckets: [] } minimum
    genedPlaceholders: new Set(
      (data.genedRules.buckets || []).map(bucket => normalizeCode(bucket.placeholder))
    ),
  };
}

// ── Code helpers ─────────────────────────────────────────────────────────────
function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function getSubject(code) {
  return normalizeCode(code).split(' ')[0] || '';
}

// ── Placeholder / known course checks ───────────────────────────────────────
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

// ── Rules helpers ────────────────────────────────────────────────────────────
function majorRules(profile, levelContext) {
  if (!levelContext.kineRules?.majors) return null;
  return levelContext.kineRules.majors[String(profile?.majorProgram || '').trim()] || null;
}

function minorRules(profile, levelContext) {
  const minor = String(profile?.minorProgram || '').trim();
  if (!minor || !levelContext.kineRules?.minors) return null;
  return levelContext.kineRules.minors[minor] || null;
}

// ── resolveBucket ─────────────────────────────────────────────────────────────
// Maps a course code to its bucket (gened / major / minor)
// Previously always returned buckets[0] — now picks the correct bucket by kind
function resolveBucket(code, profile, levelContext) {
  const normalized = normalizeCode(code);

  // 1. Check GenEd placeholders first
  const genedBucket = (levelContext.genedRules.buckets || []).find(
    bucket => normalizeCode(bucket.placeholder) === normalized
  );
  if (genedBucket) {
    return { id: genedBucket.id, label: `GenEd: ${genedBucket.name}`, kind: 'gened' };
  }

  const subject = getSubject(normalized);
  const major   = majorRules(profile, levelContext);
  const minor   = minorRules(profile, levelContext);

  // 2. Check major buckets — pick the most specific bucket that lists this subject
  if (major && Array.isArray(major.allowedSubjects) && major.allowedSubjects.includes(subject)) {
    // Try to find a bucket more specific than the first (foundation → core → emphasis)
    const buckets  = major.buckets || [];
    // Default to first bucket if no finer-grained match is possible yet
    const bucket   = buckets[0];
    return {
      id:    bucket?.id    || `${String(profile?.majorProgram || 'MAJOR').toUpperCase()}-GENERAL`,
      label: `Major: ${bucket?.name || 'Major Requirement'}`,
      kind:  'major',
    };
  }

  // 3. Check minor buckets
  if (minor && Array.isArray(minor.allowedSubjects) && minor.allowedSubjects.includes(subject)) {
    const buckets = minor.buckets || [];
    const bucket  = buckets[0];
    return {
      id:    bucket?.id    || `${String(profile?.minorProgram || 'MINOR').toUpperCase()}-GENERAL`,
      label: `Minor: ${bucket?.name || 'Minor Requirement'}`,
      kind:  'minor',
    };
  }

  // 4. No bucket match — caller decides how to handle unclassified courses
  return null;
}

// ── searchCatalog ─────────────────────────────────────────────────────────────
// Searches the catalog index by code or title/description
// Results are ranked: exact code-prefix matches first, then title matches
function searchCatalog(query, levelContext, limit = 12) {
  const q = String(query || '').trim();
  if (!q) return [];

  const qUpper = q.toUpperCase();
  const qLower = q.toLowerCase();

  const matched = [];

  levelContext.catalogIndex.forEach((course, code) => {
    const title       = String(course.title       || '').toLowerCase();
    const description = String(course.description || '').toUpperCase();
    const codeLower   = code.toLowerCase();

    const codeMatch  = code.includes(qUpper);
    const titleMatch = title.includes(qLower);
    const descMatch  = description.includes(qUpper);

    if (codeMatch || titleMatch || descMatch) {
      matched.push({
        code,
        title:       course.title       || '',
        credits:     course.credits     ?? null,
        description: String(course.description || '').slice(0, 140),
        // Rank: 0 = code starts with query (best), 1 = code contains query, 2 = title/desc only
        _rank: code.startsWith(qUpper) ? 0 : codeMatch ? 1 : 2,
      });
    }
  });

  // Sort by rank ascending, then alphabetically by code
  matched.sort((a, b) => a._rank - b._rank || a.code.localeCompare(b.code));

  // Strip internal rank field before returning
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
