#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

function resolveInputCsv() {
  const preferred = path.join(DATA_DIR, 'tcu_courses.csv');
  if (fs.existsSync(preferred)) return preferred;

  const fallback = fs
    .readdirSync(DATA_DIR)
    .filter((name) => /^courses-report.*\.csv$/i.test(name))
    .sort()
    .pop();

  if (fallback) return path.join(DATA_DIR, fallback);
  throw new Error('No source CSV found. Expected data/tcu_courses.csv or data/courses-report*.csv');
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }

  cells.push(current);
  return cells;
}

function parseCsv(content) {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || '';
    });
    return row;
  });
}

const CREDIT_RE = /^\s*(\d+(?:\.\d+)?)\s*(?:hours?|credits?)\.?/i;
const PREREQ_RE = /Prerequisites?:\s*(.*)/i;

function normalizeCredits(description) {
  const match = CREDIT_RE.exec(description || '');
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return Number.isInteger(value) ? value : value;
}

function buildCatalog(rows) {
  const catalog = {};
  rows.forEach((row) => {
    const subject = String(row['Subject Code'] || '').trim().toUpperCase();
    const number = String(row['Catalog Number'] || '').trim();
    const description = String(row.Description || '').trim();
    if (!subject || !number) return;

    const code = `${subject} ${number}`;
    const prereqMatch = PREREQ_RE.exec(description);

    catalog[code] = {
      subject,
      number,
      description,
      credits: normalizeCredits(description),
      prereqText: prereqMatch ? prereqMatch[1].trim() : null,
    };
  });
  return catalog;
}

function main() {
  const csvPath = resolveInputCsv();
  const outPath = path.join(DATA_DIR, 'catalog_index.json');

  const csvText = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(csvText);
  const catalog = buildCatalog(rows);

  const sortedCatalog = Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(outPath, `${JSON.stringify(sortedCatalog, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${Object.keys(catalog).length} courses to ${outPath}`);
}

main();
