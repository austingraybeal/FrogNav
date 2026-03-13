'use strict';

/**
 * Vercel serverless proxy for classes.tcu.edu (Ellucian Banner XE).
 *
 * GET /api/tcu-sections?subject=KINE&course=10101&term=202630
 *
 * Flow:
 *  1. POST /StudentRegistrationSsb/ssb/term/search  → establish session
 *  2. GET  /StudentRegistrationSsb/ssb/searchResults/searchResults → query sections
 *  3. Return JSON to client
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
    // Step 1: Establish session by POSTing to term/search
    const termRes = await fetch(`${BANNER_BASE}/term/search?mode=search`, {
      method: 'POST',
      headers: {
        ...BROWSER_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `term=${termCode}`,
      redirect: 'manual',
    });

    // Extract session cookies (with fallback for runtimes lacking getSetCookie)
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

    collectCookies(termRes);

    // If Banner redirected, follow manually to complete session setup
    const location = termRes.headers.get('location');
    if (location && termRes.status >= 300 && termRes.status < 400) {
      const redirectUrl = location.startsWith('http')
        ? location
        : `https://classes.tcu.edu${location}`;
      const cookieSoFar = [...allCookies.values()].join('; ');
      const followRes = await fetch(redirectUrl, {
        headers: { ...BROWSER_HEADERS, 'Cookie': cookieSoFar },
        redirect: 'manual',
      });
      collectCookies(followRes);
    }

    const cookieStr = [...allCookies.values()].join('; ');

    if (!cookieStr) {
      return res.status(502).json({
        detail: 'Could not establish session with classes.tcu.edu. The site may be down.',
      });
    }

    // Step 2: Search for sections
    const params = new URLSearchParams({
      txt_subject: subject,
      txt_term: termCode,
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
        'Cookie': cookieStr,
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
