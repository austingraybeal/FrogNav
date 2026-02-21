const { searchCatalog } = require('../lib/catalogRules');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  const q = req.query?.q || '';
  const limit = Number(req.query?.limit || 12);
  return res.status(200).json({ results: searchCatalog(q, limit) });
};
