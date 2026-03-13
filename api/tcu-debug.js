'use strict';

/**
 * Diagnostic endpoint to discover which Banner XE paths work at classes.tcu.edu
 * GET /api/tcu-debug?term=202630
 */

const BASE = 'https://classes.tcu.edu';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function probe(url, opts = {}) {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      ...opts,
      headers: { ...BROWSER_HEADERS, ...(opts.headers || {}) },
      redirect: 'manual',
    });
    const elapsed = Date.now() - start;
    const body = await res.text().catch(() => '');
    return {
      url,
      status: res.status,
      location: res.headers.get('location') || null,
      contentType: res.headers.get('content-type') || null,
      bodyLength: body.length,
      bodySnippet: body.slice(0, 500),
      cookies: res.headers.get('set-cookie') ? res.headers.get('set-cookie').slice(0, 200) : null,
      elapsed,
    };
  } catch (err) {
    return { url, error: err.message, elapsed: Date.now() - start };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const term = req.query.term || '202630';
  const results = {};

  // 1. Probe root
  results.root = await probe(BASE);

  // 2. Probe common Banner base paths
  const basePaths = [
    '/StudentRegistrationSsb',
    '/StudentRegistrationSsb/ssb',
    '/StudentRegistrationSsb/ssb/registration',
    '/StudentRegistrationSsb/ssb/classSearch/classSearch',
    '/BannerExtensibility',
    '/ssb',
  ];
  results.basePaths = {};
  for (const p of basePaths) {
    results.basePaths[p] = await probe(`${BASE}${p}`);
  }

  // 3. Try term/search POST
  results.termSearch = await probe(`${BASE}/StudentRegistrationSsb/ssb/term/search?mode=search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `term=${term}`,
  });

  // Extract cookies from term search
  let cookieStr = '';
  if (results.termSearch.cookies) {
    cookieStr = results.termSearch.cookies.split(/,(?=\s*\w+=)/)
      .map(c => c.split(';')[0].trim())
      .join('; ');
  }

  // 4. Try many search result paths WITH session cookies
  const searchPaths = [
    '/StudentRegistrationSsb/ssb/searchResults/searchResults',
    '/StudentRegistrationSsb/ssb/courseSearchResults/courseSearchResults',
    '/StudentRegistrationSsb/ssb/classSearch/getSubjects',
    '/StudentRegistrationSsb/ssb/classSearch/get_subject',
    '/StudentRegistrationSsb/ssb/classSearch/getTerms',
    '/StudentRegistrationSsb/ssb/courseSearch/courseSearch',
    '/StudentRegistrationSsb/ssb/courseSearch/course_search_results',
    '/StudentRegistrationSsb/ssb/searchResults/getClassDetails',
    '/StudentRegistrationSsb/ssb/registration/registration',
  ];

  const subjectParams = `?txt_subject=KINE&txt_term=${term}&pageOffset=0&pageMaxSize=10&sortColumn=subjectDescription&sortDirection=asc`;

  results.searchPaths = {};
  for (const p of searchPaths) {
    results.searchPaths[p] = await probe(`${BASE}${p}${subjectParams}`, {
      headers: { 'Cookie': cookieStr },
    });
  }

  // 5. Also try some paths without query params (just to see if they exist)
  results.plainPaths = {};
  for (const p of searchPaths.slice(0, 4)) {
    results.plainPaths[p] = await probe(`${BASE}${p}`, {
      headers: { 'Cookie': cookieStr },
    });
  }

  return res.status(200).json(results);
};
