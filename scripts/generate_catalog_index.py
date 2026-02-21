#!/usr/bin/env python3
import csv, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / 'data' / 'tcu_courses.csv'
if not CSV_PATH.exists():
    # fallback to old filename
    legacy = ROOT / 'data' / 'courses-report.2026-02-20.csv'
    if legacy.exists():
      CSV_PATH = legacy

OUT_PATH = ROOT / 'data' / 'catalog_index.json'

CREDIT_RE = re.compile(r'^\s*(\d+(?:\.\d+)?)\s*(?:hours?|credits?)\.?', re.IGNORECASE)
PREREQ_RE = re.compile(r'Prerequisites?:\s*(.*)', re.IGNORECASE | re.DOTALL)

catalog = {}

with CSV_PATH.open(newline='', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    for row in reader:
        subject = (row.get('Subject Code') or '').strip().upper()
        number = (row.get('Catalog Number') or '').strip()
        desc = (row.get('Description') or '').strip()
        if not subject or not number:
            continue
        code = f"{subject} {number}"

        credits = None
        m = CREDIT_RE.match(desc)
        if m:
            credits = float(m.group(1))
            if credits.is_integer():
                credits = int(credits)

        prereq_text = None
        pm = PREREQ_RE.search(desc)
        if pm:
            prereq_text = pm.group(1).strip()

        catalog[code] = {
            'subject': subject,
            'number': number,
            'description': desc,
            'credits': credits,
            'prereqText': prereq_text,
        }

OUT_PATH.write_text(json.dumps(catalog, indent=2, sort_keys=True), encoding='utf-8')
print(f'Wrote {len(catalog)} courses to {OUT_PATH}')
