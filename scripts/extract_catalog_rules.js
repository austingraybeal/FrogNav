#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');

const kineRulesUndergrad = {
  source: 'data/tcu_undergrad_catalog.pdf',
  extractionStatus: 'Curated extraction for Kinesiology undergraduate pathways.',
  policies: [
    'No P/NC for KINE core/foundation/emphasis/associated requirements; C- minimum.',
    'GPA rules: 2.5 for Movement Science and Health and Fitness core+foundation+emphasis.',
    'GPA rules: 2.75 overall for Physical Education and Physical Education with Strength and Conditioning to remain in program.',
  ],
  majors: {
    'Movement Science': { default: true, allowedSubjects: ['KINE', 'HLTH'], buckets: [{ id: 'MS-CORE', name: 'Kinesiology Major Requirements' }] },
    'Health and Fitness': { allowedSubjects: ['KINE', 'HLTH'], buckets: [{ id: 'HF-CORE', name: 'Kinesiology Major Requirements' }] },
    'Physical Education': { allowedSubjects: ['KINE', 'HLTH', 'EDUC'], buckets: [{ id: 'PE-CORE', name: 'Kinesiology Major Requirements' }] },
    'Physical Education with Strength and Conditioning': { allowedSubjects: ['KINE', 'HLTH', 'EDUC'], buckets: [{ id: 'PESC-CORE', name: 'Kinesiology Major Requirements' }] },
    'Movement Science/MS Athletic Training (3+2)': { allowedSubjects: ['KINE', 'HLTH', 'ATTR'], buckets: [{ id: 'MSAT-CORE', name: 'Kinesiology Major Requirements' }] },
  },
  minors: {
    Coaching: { allowedSubjects: ['KINE', 'HLTH'], buckets: [{ id: 'MIN-COACHING', name: 'Minor Requirements' }] },
    Fitness: { allowedSubjects: ['KINE', 'HLTH'], buckets: [{ id: 'MIN-FITNESS', name: 'Minor Requirements' }] },
    Health: { allowedSubjects: ['KINE', 'HLTH'], buckets: [{ id: 'MIN-HEALTH', name: 'Minor Requirements' }] },
    'Movement Science': { allowedSubjects: ['KINE', 'HLTH'], buckets: [{ id: 'MIN-MS', name: 'Minor Requirements' }] },
    'Physical Education': { allowedSubjects: ['KINE', 'HLTH', 'EDUC'], buckets: [{ id: 'MIN-PE', name: 'Minor Requirements' }] },
    'Sport and Exercise Psychology': { allowedSubjects: ['KINE', 'HLTH', 'PSYC'], buckets: [{ id: 'MIN-SEP', name: 'Minor Requirements' }] },
  },
};

const genedRulesUndergrad = {
  source: 'data/tcu_undergrad_catalog.pdf',
  extractionStatus: 'Curated extraction of TCU Core requirement buckets.',
  buckets: [
    { id: 'GENED-ENGLISH', name: 'English Composition', type: 'course_count', minCourses: 2, placeholder: 'TCU Core: English Composition — choose approved course' },
    { id: 'GENED-MATH', name: 'Mathematics', type: 'course_count', minCourses: 1, placeholder: 'TCU Core: Mathematics — choose approved course' },
    { id: 'GENED-SCI-NAT', name: 'Natural Science', type: 'course_count', minCourses: 2, placeholder: 'TCU Core: Natural Science — choose approved course' },
    { id: 'GENED-HIST', name: 'History', type: 'course_count', minCourses: 1, placeholder: 'TCU Core: History — choose approved course' },
    { id: 'GENED-GOV', name: 'Government', type: 'course_count', minCourses: 1, placeholder: 'TCU Core: Government — choose approved course' },
    { id: 'GENED-SOCIAL', name: 'Social Sciences', type: 'course_count', minCourses: 1, placeholder: 'TCU Core: Social Sciences — choose approved course' },
    { id: 'GENED-HUM', name: 'Humanities', type: 'course_count', minCourses: 1, placeholder: 'TCU Core: Humanities — choose approved course' },
    { id: 'GENED-RELIGION', name: 'Religion', type: 'course_count', minCourses: 1, placeholder: 'TCU Core: Religion — choose approved course' },
    { id: 'GENED-CULTURE', name: 'Cultural Awareness', type: 'course_count', minCourses: 1, placeholder: 'TCU Core: Cultural Awareness — choose approved course' },
    { id: 'GENED-COMM', name: 'Oral Communication', type: 'course_count', minCourses: 1, placeholder: 'TCU Core: Oral Communication — choose approved course' },
  ],
};

const kineRulesGrad = {
  source: 'data/tcu_grad_catalog.pdf',
  extractionStatus: 'Curated extraction for Kinesiology, MS degree policies and requirements.',
  policies: [
    'Kinesiology, MS students must maintain a minimum 3.0 GPA in graduate coursework.',
    'Program includes required research core plus specialization/resource/thesis buckets as cataloged.',
  ],
  majors: {
    'Kinesiology, MS': {
      default: true,
      allowedSubjects: ['KINE', 'EDSP', 'NUTR', 'STAT', 'PSYC'],
      buckets: [
        {
          id: 'KINEMS-REQUIRED',
          name: 'Kinesiology MS Required Courses',
          requiredCourses: ['KINE 60103', 'KINE 60113', 'KINE 60213', 'KINE 60423', 'KINE 60613'],
        },
        { id: 'KINEMS-SPECIALIZATION', name: 'Specialization Coursework', minCredits: 9 },
        { id: 'KINEMS-RESOURCE', name: 'Resource Coursework', minCredits: 6 },
        { id: 'KINEMS-THESIS', name: 'Thesis / Non-thesis Option', minCredits: 6 },
      ],
    },
  },
  minors: {},
  gradPolicy: {
    minimumGPA: 3.0,
    note: 'Graduate students earning below a 3.0 GPA are subject to probation/dismissal per graduate catalog policy.',
  },
};

const files = [
  ['kine_rules_undergrad.json', kineRulesUndergrad],
  ['gened_rules_undergrad.json', genedRulesUndergrad],
  ['kine_rules_grad.json', kineRulesGrad],
];

files.forEach(([name, payload]) => {
  fs.writeFileSync(path.join(DATA, name), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${name}`);
});
