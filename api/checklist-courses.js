'use strict';

const path = require('path');
const fs   = require('fs');

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
  }

  const level = String(req.query.level || 'undergrad').trim().toLowerCase();
  const major = String(req.query.major || '').trim();

  if (level !== 'undergrad') {
    return res.status(200).json({ courses: [] });
  }

  const rulesPath = path.join(process.cwd(), 'data', 'kine_rules_undergrad.json');
  const rules     = loadJson(rulesPath);

  if (!rules) {
    return res.status(500).json({ code: 'RULES_NOT_FOUND', courses: [] });
  }

  // Find matching major (case-insensitive)
  const majorKey  = Object.keys(rules.majors || {}).find(
    k => k.toLowerCase() === major.toLowerCase()
  );
  const majorData = majorKey ? rules.majors[majorKey] : null;

  if (!majorData || !Array.isArray(majorData.buckets)) {
    return res.status(200).json({ courses: [] });
  }

  // Load catalog for title/credit lookup
  const catalogPath = path.join(process.cwd(), 'data', 'undergrad', 'catalog.json');
  const catalog     = loadJson(catalogPath);
  const courseMap   = new Map();
  if (catalog && Array.isArray(catalog.courses)) {
    catalog.courses.forEach(c => {
      if (c.code) courseMap.set(c.code.toUpperCase(), c);
    });
  }

  function resolveCourse(code, groupName) {
    const entry = courseMap.get(code.toUpperCase());
    return {
      code,
      title:   entry?.title       || code,
      credits: entry?.credits     ?? null,
      group:   groupName,
    };
  }

  const courses = [];

  majorData.buckets.forEach(bucket => {
    const groupName = bucket.name || bucket.id || 'Other';

    (bucket.requiredCourses || []).forEach(code => {
      courses.push(resolveCourse(code, groupName));
    });

    (bucket.chooseFrom || []).forEach(code => {
      courses.push(resolveCourse(code, groupName));
    });
  });

  return res.status(200).json({ courses });
};
