const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');

function loadJson(relativePath) {
  const fullPath = path.join(root, relativePath);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

const catalogIndex = loadJson('data/catalog_index.json');
const kineRules = loadJson('data/kine_rules.json');
const genedRules = loadJson('data/gened_rules.json');

const genedPlaceholders = new Set((genedRules.buckets || []).map((bucket) => bucket.placeholder));

function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function isKnownCourseOrPlaceholder(code) {
  const normalized = normalizeCode(code);
  return Boolean(catalogIndex[normalized] || genedPlaceholders.has(code) || genedPlaceholders.has(normalized));
}

function getSubject(code) {
  return normalizeCode(code).split(' ')[0] || '';
}

function majorRules(profile) {
  return kineRules.majors?.[String(profile?.majorProgram || '').trim()] || null;
}

function minorRules(profile) {
  const minor = String(profile?.minorProgram || '').trim();
  if (!minor) return null;
  return kineRules.minors?.[minor] || null;
}

function resolveBucket(code, profile) {
  const normalized = normalizeCode(code);
  const major = majorRules(profile);
  const minor = minorRules(profile);

  const genedBucket = (genedRules.buckets || []).find(
    (bucket) => bucket.placeholder === code || bucket.placeholder.toUpperCase() === normalized
  );
  if (genedBucket) return { id: genedBucket.id, label: `GenEd: ${genedBucket.name}`, kind: 'gened' };

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

function searchCatalog(query, limit = 12) {
  const q = String(query || '').trim().toUpperCase();
  if (!q) return [];

  const results = [];
  Object.entries(catalogIndex).forEach(([code, course]) => {
    if (
      code.includes(q) ||
      String(course.description || '').toUpperCase().includes(q)
    ) {
      results.push({
        code,
        description: String(course.description || '').slice(0, 140),
      });
    }
  });

  return results.slice(0, Math.max(1, limit));
}

module.exports = {
  catalogIndex,
  kineRules,
  genedRules,
  normalizeCode,
  isKnownCourseOrPlaceholder,
  resolveBucket,
  searchCatalog,
};
