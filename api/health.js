'use strict';

const fs   = require('fs');
const path = require('path');

const FILES_TO_CHECK = {
  'undergrad/catalog':    path.join(process.cwd(), 'data', 'undergrad', 'catalog.json'),
  'undergrad/gened':      path.join(process.cwd(), 'data', 'undergrad', 'gened_rules.json'),
  'grad/catalog':         path.join(process.cwd(), 'data', 'grad',      'catalog.json'),
  'kine_rules_undergrad': path.join(process.cwd(), 'data', 'kine_rules_undergrad.json'),
  'grad_rules':           path.join(process.cwd(), 'data', 'grad_rules.json'),
};

module.exports = function handler(req, res) {
  const status = {};
  Object.entries(FILES_TO_CHECK).forEach(([key, filePath]) => {
    status[key] = fs.existsSync(filePath) ? 'ok' : 'missing';
  });

  const allOk   = Object.values(status).every(v => v === 'ok');
  const apiKey = Boolean(process.env.ANTHROPIC_API_KEY);

  return res.status(allOk && apiKey ? 200 : 503).json({
    healthy:    allOk && apiKey,
    openaiKey:  apiKey ? 'set' : 'MISSING',
    dataFiles:  status,
  });
};
