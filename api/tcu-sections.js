'use strict';

/**
 * Vercel serverless proxy for classes.tcu.edu (Ellucian Banner XE).
 *
 * GET /api/tcu-sections?subject=KINE&course=10101&term=202630
 *
 * Flow (all 4 steps required by Banner XE):
 *  1. GET  classSearch/getTerms        → establish session cookies
 *  2. POST term/search                 → authorize session for a term
 *  3. POST classSearch/resetDataForm   → clear prior search state
 *  4. GET  searchResults/searchResults  → query sections
 */

const BANNER_BASE = 'https://classes.tcu.edu/StudentRegistrationSsb/ssb';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer': 'https://classes.tcu.edu/StudentRegistrationSsb/ssb/classSearch/classSearch',
  'Accept': 'application/json',
};

// Default to current term if not supplied — Fall 2026 = 202690, Spring 2026 = 202630
function defaultTermCode() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  // Spring: Jan-May → 30, Summer: Jun-Jul → 50, Fall: Aug-Dec → 90
  const suffix = month <= 5 ? '30' : month <= 7 ? '50' : '90';
  return `${year}${suffix}`;
}

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const subject = (req.query.subject || '').trim().toUpperCase();
  if (!subject) {
    return res.status(400).json({ detail: 'Missing required "subject" query parameter (e.g. KINE).' });
  }

  const courseNumber = (req.query.course || '').trim();
  const termCode = (req.query.term || '').trim() || defaultTermCode();

  try {
    // Cookie jar — accumulates Set-Cookie headers across all requests
    const allCookies = new Map();

    function collectCookies(response) {
      let raw = [];
      if (typeof response.headers.getSetCookie === 'function') {
        raw = response.headers.getSetCookie();
      } else {
        const hdr = response.headers.get('set-cookie') || '';
        if (hdr) raw = hdr.split(/,(?=\s*\w+=)/).filter(Boolean);
      }
      for (const c of raw) {
        const pair = c.split(';')[0];
        const eqIdx = pair.indexOf('=');
        if (eqIdx > 0) allCookies.set(pair.slice(0, eqIdx).trim(), pair);
      }
    }

    function cookieStr() {
      return [...allCookies.values()].join('; ');
    }

    // Step 1: GET getTerms to establish JSESSIONID + site cookies
    const termsRes = await fetch(
      `${BANNER_BASE}/classSearch/getTerms?offset=1&max=20&searchTerm=`,
      { headers: BROWSER_HEADERS, redirect: 'manual' },
    );
    collectCookies(termsRes);

    // Step 2: POST term/search to authorize the session for this term
    const termRes = await fetch(`${BANNER_BASE}/term/search`, {
      method: 'POST',
      headers: {
        ...BROWSER_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieStr(),
      },
      body: `term=${termCode}&studyPath=&studyPathText=&startDatepicker=&endDatepicker=`,
      redirect: 'manual',
    });
    collectCookies(termRes);

    // Follow redirect if Banner sends one after term selection
    const location = termRes.headers.get('location');
    if (location && termRes.status >= 300 && termRes.status < 400) {
      const redirectUrl = location.startsWith('http')
        ? location
        : `https://classes.tcu.edu${location}`;
      const followRes = await fetch(redirectUrl, {
        headers: { ...BROWSER_HEADERS, 'Cookie': cookieStr() },
        redirect: 'manual',
      });
      collectCookies(followRes);
    }

    if (!cookieStr()) {
      return res.status(502).json({
        detail: 'Could not establish session with classes.tcu.edu. The site may be down.',
      });
    }

    // Step 3: POST resetDataForm to clear any prior search state
    await fetch(`${BANNER_BASE}/classSearch/resetDataForm`, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, 'Cookie': cookieStr() },
    });

    // Step 4: GET searchResults with query params
    const params = new URLSearchParams({
      txt_subject: subject,
      txt_term: termCode,
      startDatepicker: '',
      endDatepicker: '',
      pageOffset: '0',
      pageMaxSize: '50',
      sortColumn: 'subjectDescription',
      sortDirection: 'asc',
    });
    if (courseNumber) params.set('txt_courseNumber', courseNumber);

    const searchRes = await fetch(`${BANNER_BASE}/searchResults/searchResults?${params}`, {
      method: 'GET',
      headers: {
        ...BROWSER_HEADERS,
        'Cookie': cookieStr(),
      },
    });

    const searchData = await searchRes.json().catch(() => ({}));

    if (!searchData.success) {
      return res.status(200).json({
        sections: [],
        totalCount: 0,
        term: termCode,
        detail: searchData.message || `Search returned success=false (HTTP ${searchRes.status}).`,
      });
    }

    const sections = (searchData.data || []).map(sec => ({
      courseReferenceNumber: sec.courseReferenceNumber,
      subject: sec.subject,
      courseNumber: sec.courseNumber,
      sequenceNumber: sec.sequenceNumber,
      courseTitle: sec.courseTitle,
      creditHours: sec.creditHours,
      maximumEnrollment: sec.maximumEnrollment,
      enrollment: sec.enrollment,
      seatsAvailable: sec.seatsAvailable,
      waitCapacity: sec.waitCapacity,
      waitCount: sec.waitCount,
      faculty: (sec.faculty || []).map(f => ({
        displayName: f.displayName,
        emailAddress: f.emailAddress,
      })),
      meetingsFaculty: (sec.meetingsFaculty || []).map(mf => ({
        meetingTime: mf.meetingTime ? {
          beginTime: mf.meetingTime.beginTime,
          endTime: mf.meetingTime.endTime,
          monday: mf.meetingTime.monday,
          tuesday: mf.meetingTime.tuesday,
          wednesday: mf.meetingTime.wednesday,
          thursday: mf.meetingTime.thursday,
          friday: mf.meetingTime.friday,
          saturday: mf.meetingTime.saturday,
          sunday: mf.meetingTime.sunday,
          building: mf.meetingTime.building,
          room: mf.meetingTime.room,
        } : null,
      })),
    }));

    return res.status(200).json({
      sections,
      totalCount: searchData.totalCount || sections.length,
      term: termCode,
    });

  } catch (err) {
    return res.status(502).json({
      detail: `Failed to reach classes.tcu.edu: ${err.message || 'Unknown error'}`,
    });
  }
};
