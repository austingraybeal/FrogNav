const { normalizeLevel, getLevelContext, searchCatalog } = require('../lib/catalogRules');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ code: 'FROGNAV_METHOD_NOT_ALLOWED', detail: 'Method not allowed.' });

  const q = req.query?.q || '';
  const level = normalizeLevel(req.query?.level || 'undergrad');
  const limit = Number(req.query?.limit || 12);
  const levelContext = getLevelContext(level);
  return res.status(200).json({ results: searchCatalog(q, levelContext, limit) });
};
