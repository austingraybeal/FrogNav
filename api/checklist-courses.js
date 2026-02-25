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
    // Grad checklist not yet implemented — return empty
    return res.status(200).json({ courses: [] });
  }

  const rulesPath = path.join(process.cwd(), 'data', 'kine_rules_undergrad.json');
  const rules     = loadJson(rulesPath);

  if (!rules) {
    return res.status(500).json({ code: 'RULES_NOT_FOUND', courses: [] });
  }

  // Find the matching major
  const majorKey  = Object.keys(rules.majors || {}).find(
    k => k.toLowerCase() === major.toLowerCase()
  );
  const majorData = majorKey ? rules.majors[majorKey] : null;

  if (!majorData) {
    return res.status(200).json({ courses: [] });
  }

  // Flatten all requirement groups into a list with a group label
  const courses = [];
  const sections = majorData.requirements || majorData.sections || {};

  Object.entries(sections).forEach(([groupName, groupData]) => {
    const courseList = Array.isArray(groupData)
      ? groupData
      : Array.isArray(groupData.courses)
        ? groupData.courses
        : [];

    courseList.forEach(course => {
      if (!course || !course.code) return;
      courses.push({
        code:    course.code,
        title:   course.title   || course.name || course.code,
        credits: course.credits ?? null,
        group:   groupName,
      });
    });
  });

  return res.status(200).json({ courses });
};
