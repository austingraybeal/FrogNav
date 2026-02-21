#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

const LEVELS = [
  { level: 'undergrad', input: 'tcu_courses_undergrad.csv', output: 'catalog_index_undergrad.json' },
  { level: 'grad', input: 'tcu_courses_grad.csv', output: 'catalog_index_grad.json' },
];

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

function parseCsv(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0] || '');
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, idx) => {
      row[String(header || '').trim()] = String(values[idx] || '').trim();
    });
    return row;
  });
}

function parseCredits(description) {
  const m = String(description || '').match(/^\s*(\d+(?:\.\d+)?)\s*(?:hours?|credits?)\.?/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return Number.isInteger(n) ? n : n;
}

function parsePrereqText(description) {
  const m = String(description || '').match(/Prerequisites?:\s*(.*)/i);
  return m ? m[1].trim() : null;
}

function parseTitle(row) {
  const explicit = row['Course Title'] || row['Title'] || row['Long Title'];
  if (explicit) return explicit.trim();
  return null;
}

function buildIndex(rows) {
  const out = {};
  rows.forEach((row) => {
    const subject = String(row['Subject Code'] || '').trim().toUpperCase();
    const number = String(row['Catalog Number'] || '').trim();
    if (!subject || !number) return;

    const code = `${subject} ${number}`;
    const description = String(row.Description || '').trim();

    out[code] = {
      code,
      title: parseTitle(row),
      credits: parseCredits(description),
      prereqText: parsePrereqText(description),
      description,
    };
  });

  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

for (const cfg of LEVELS) {
  const inPath = path.join(DATA_DIR, cfg.input);
  const outPath = path.join(DATA_DIR, cfg.output);
  const rows = parseCsv(inPath);
  const catalog = buildIndex(rows);
  fs.writeFileSync(outPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${Object.keys(catalog).length} ${cfg.level} catalog courses to ${cfg.output}`);
}
