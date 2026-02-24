const fs = require('fs');
const path = require('path');

module.exports = function handler(req, res) {
  const root = process.cwd();
  const files = {
    undergradCsv: fs.existsSync(path.join(root, 'data', 'tcu_courses_undergrad.csv')),
    gradCsv: fs.existsSync(path.join(root, 'data', 'tcu_courses_grad.csv')),
    undergradPdf: fs.existsSync(path.join(root, 'data', 'tcu_undergrad_catalog.pdf')),
    gradPdf: fs.existsSync(path.join(root, 'data', 'tcu_grad_catalog.pdf')),
    kineRules: fs.existsSync(path.join(root, 'data', 'kine_rules_undergrad.json')),
    genedRules: fs.existsSync(path.join(root, 'data', 'gened_rules_undergrad.json')),
  };

  return res.status(200).json({
    ok: true,
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    nodeVersion: process.version,
    cwd: root,
    files,
  });
};
