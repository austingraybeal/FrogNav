'use strict';

/**
 * Vercel serverless proxy for classes.tcu.edu (ASP.NET WebForms).
 *
 * GET /api/tcu-sections?subject=KINE&course=30403&term=202630
 *
 * Flow:
 *  1. GET  https://classes.tcu.edu/ → extract __VIEWSTATE, __EVENTVALIDATION, cookies
 *  2. POST https://classes.tcu.edu/ → submit search form with ASP.NET tokens
 *  3. Parse HTML <TABLE class="results"> into JSON matching front-end format
 */

const TCU_URL = 'https://classes.tcu.edu/';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

// ── Term-code conversion ────────────────────────────────────────────────────
// Our app uses YYYYSS (e.g. 202630 = Spring 2026).
// TCU uses 4 + 2-digit year + semester digit:
//   1 = Winter/Interim, 3 = Spring, 5 = Summer, 7 = Fall
// Example: Spring 2026 → "4263"
function toTcuTerm(appTerm) {
  if (!appTerm || appTerm.length !== 6) return appTerm; // pass through if weird
  const year2 = appTerm.slice(2, 4); // "26" from "202630"
  const suffixMap = { '10': '1', '30': '3', '50': '5', '90': '7' };
  const sem = suffixMap[appTerm.slice(4, 6)] || '3';
  return `4${year2}${sem}`;
}

// Default term code in our YYYYSS format
function defaultTermCode() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const suffix = month <= 5 ? '30' : month <= 7 ? '50' : '90';
  return `${year}${suffix}`;
}

// ── Cookie helpers ──────────────────────────────────────────────────────────
function collectCookies(response, jar) {
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
    if (eqIdx > 0) jar.set(pair.slice(0, eqIdx).trim(), pair);
  }
}
function cookieStr(jar) {
  return [...jar.values()].join('; ');
}

// ── HTML parsing helpers ────────────────────────────────────────────────────
function extractHidden(html, name) {
  // Match: <input type="hidden" name="__VIEWSTATE" ... value="..." />
  const re = new RegExp(
    `<input[^>]+name="${name}"[^>]+value="([^"]*)"`,
    'i',
  );
  const m = html.match(re);
  return m ? m[1] : '';
}

function stripTags(s) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parse the <TABLE class="results"> rows into section objects.
 * Each <TR> after the header has ~15 <TD> columns.
 *
 * Column layout (from HAR analysis):
 *  0  CRN (link)
 *  1  Subject + Course (e.g. "KINE 30403")
 *  2  (empty or attribute)
 *  3  Section + registration link
 *  4  Type (LEC, LAB, etc.)
 *  5  (credit hours or empty)
 *  6  Course Title
 *  7  Start Date
 *  8  Instruction Mode
 *  9  Days + Time (e.g. "MWF<BR>11:00-11:50")
 * 10  Status (Open / Closed)
 * 11  Enrollment / Max (e.g. "46<BR>40")
 * 12  (reserved or empty)
 * 13  Wait / WaitCap (e.g. "0<BR>20")
 * 14  Instructor(s)
 */
function parseResultsTable(html) {
  // Find the results table
  const tableMatch = html.match(/<TABLE[^>]*class="results"[^>]*>([\s\S]*?)<\/TABLE>/i);
  if (!tableMatch) return [];

  const tableHtml = tableMatch[1];

  // Split into rows
  const rows = tableHtml.split(/<TR\b/i).slice(1); // skip first empty split

  const sections = [];

  for (const row of rows) {
    // Skip header row (has <TH> or no bgcolor)
    if (/<TH\b/i.test(row)) continue;

    // Extract all <TD> contents
    const tds = [];
    const tdRegex = /<TD[^>]*>([\s\S]*?)<\/TD>/gi;
    let tdMatch;
    while ((tdMatch = tdRegex.exec(row)) !== null) {
      tds.push(tdMatch[1]);
    }

    if (tds.length < 10) continue; // not a data row

    // Column 0: CRN
    const crnMatch = tds[0].match(/(\d{4,6})/);
    const crn = crnMatch ? crnMatch[1] : stripTags(tds[0]);

    // Column 1: Subject + CourseNumber (e.g. "KINE 30403")
    const subjCourse = stripTags(tds[1]);
    const scParts = subjCourse.split(/\s+/);
    const subject = scParts[0] || '';
    const courseNumber = scParts[1] || '';

    // Column 3: Section number
    const seqRaw = stripTags(tds[3]);
    const seqMatch = seqRaw.match(/(\d{2,4})/);
    const sequenceNumber = seqMatch ? seqMatch[1] : seqRaw.split(/\s/)[0] || '';

    // Column 6: Course Title
    const courseTitle = stripTags(tds[6]);

    // Column 5: Credit hours
    const creditRaw = stripTags(tds[5]);
    const creditHours = parseFloat(creditRaw) || null;

    // Column 9: Days + Time
    const dayTimeRaw = tds[9] || '';
    const dayTimeParts = dayTimeRaw.split(/<BR\s*\/?>/i);
    const daysStr = stripTags(dayTimeParts[0] || '');
    const timeStr = stripTags(dayTimeParts[1] || '');
    const timeParts = timeStr.split('-');
    const beginTime = (timeParts[0] || '').replace(':', '').trim();
    const endTime = (timeParts[1] || '').replace(':', '').trim();

    // Parse day letters into booleans
    const dayMap = {
      M: 'monday', T: 'tuesday', W: 'wednesday',
      R: 'thursday', F: 'friday', S: 'saturday', U: 'sunday',
    };
    const meetingTime = {
      beginTime: beginTime || null,
      endTime: endTime || null,
      monday: false, tuesday: false, wednesday: false,
      thursday: false, friday: false, saturday: false, sunday: false,
      building: null, room: null,
    };
    for (const ch of daysStr) {
      if (dayMap[ch]) meetingTime[dayMap[ch]] = true;
    }

    // Column 10: Status
    const statusText = stripTags(tds[10] || '');

    // Column 11: Enrollment / Max
    const enrollRaw = (tds[11] || '').split(/<BR\s*\/?>/i);
    const enrollment = parseInt(stripTags(enrollRaw[0]), 10) || 0;
    const maximumEnrollment = parseInt(stripTags(enrollRaw[1] || enrollRaw[0]), 10) || 0;
    const seatsAvailable = Math.max(0, maximumEnrollment - enrollment);

    // Column 13: Wait / WaitCap
    const waitRaw = (tds[13] || '').split(/<BR\s*\/?>/i);
    const waitCount = parseInt(stripTags(waitRaw[0]), 10) || 0;
    const waitCapacity = parseInt(stripTags(waitRaw[1] || '0'), 10) || 0;

    // Column 14: Instructor
    const instructorRaw = tds.length > 14 ? stripTags(tds[14]) : '';
    const faculty = instructorRaw
      ? [{ displayName: instructorRaw, emailAddress: null }]
      : [];

    sections.push({
      courseReferenceNumber: crn,
      subject,
      courseNumber,
      sequenceNumber,
      courseTitle,
      creditHours,
      maximumEnrollment,
      enrollment,
      seatsAvailable,
      waitCapacity,
      waitCount,
      faculty,
      meetingsFaculty: [{
        meetingTime: (beginTime || daysStr) ? meetingTime : null,
      }],
    });
  }

  return sections;
}

// ── Main handler ────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const subject = (req.query.subject || '').trim().toUpperCase();
  if (!subject) {
    return res
      .status(400)
      .json({ detail: 'Missing required "subject" query parameter (e.g. KINE).' });
  }

  const courseNumber = (req.query.course || '').trim();
  const appTerm = (req.query.term || '').trim() || defaultTermCode();
  const tcuTerm = toTcuTerm(appTerm);
  const debug = req.query.debug === '1';

  try {
    const jar = new Map();

    // Step 1: GET the search page to obtain __VIEWSTATE, __EVENTVALIDATION, and cookies
    const getRes = await fetch(TCU_URL, {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
    });
    collectCookies(getRes, jar);

    const pageHtml = await getRes.text();
    const viewState = extractHidden(pageHtml, '__VIEWSTATE');
    const eventValidation = extractHidden(pageHtml, '__EVENTVALIDATION');
    const viewStateGen = extractHidden(pageHtml, '__VIEWSTATEGENERATOR');

    // Extract form action and all field names from step1
    const formActionMatch = pageHtml.match(/<form[^>]+action="([^"]+)"/i);
    const formAction = formActionMatch ? formActionMatch[1] : './';
    const postUrl = new URL(formAction, TCU_URL).href;

    // Extract ALL select/input field names (non-hidden)
    const allFields = [];
    const fieldRe = /<(?:input|select|textarea)[^>]+name="([^"]+)"[^>]*/gi;
    let _fm;
    while ((_fm = fieldRe.exec(pageHtml)) !== null) allFields.push(_fm[1]);

    // Extract select options for key dropdowns (term, subject)
    function getSelectOptions(html, selectName) {
      const selRe = new RegExp(`<select[^>]+name="${selectName}"[^>]*>([\\s\\S]*?)</select>`, 'i');
      const selMatch = html.match(selRe);
      if (!selMatch) return null;
      const opts = [];
      const optRe = /<option[^>]+value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi;
      let om;
      while ((om = optRe.exec(selMatch[1])) !== null) opts.push({ value: om[1], text: stripTags(om[2]) });
      return opts.slice(0, 15); // limit for debug
    }

    if (!viewState) {
      return res.status(502).json({
        detail:
          'Could not extract form tokens from classes.tcu.edu. The site may be down or blocking requests.',
        ...(debug && {
          _debug: {
            step1_status: getRes.status,
            step1_html_length: pageHtml.length,
            formAction,
            allFields,
            step1_snippet: pageHtml.slice(0, 2000),
          },
        }),
      });
    }

    // Build form data using the exact field names found on the page
    const termFieldName = allFields.find(f => /term/i.test(f) && !f.startsWith('__')) || 'ddlTerm';
    const subjectFieldName = allFields.find(f => /subj/i.test(f) && !f.startsWith('__')) || 'ddlSubject';
    const searchBtnName = allFields.find(f => /search|submit/i.test(f) && !f.startsWith('__')) || 'btnSearch';

    // Extract actual default values from the page HTML so __EVENTVALIDATION accepts them
    function getSelectedValue(html, selectName, fallback) {
      const selRe = new RegExp(`<select[^>]+name="${selectName}"[^>]*>([\\s\\S]*?)</select>`, 'i');
      const selMatch = html.match(selRe);
      if (!selMatch) return fallback;
      // Look for selected option — handle both `selected ... value` and `value ... selected` orders
      const selectedRe1 = /<option[^>]+selected[^>]+value="([^"]*)"/i;
      const sm1 = selMatch[1].match(selectedRe1);
      if (sm1) return sm1[1];
      const selectedRe2 = /<option[^>]+value="([^"]*)"[^>]+selected/i;
      const sm2 = selMatch[1].match(selectedRe2);
      if (sm2) return sm2[1];
      // Fall back to first option value
      const firstRe = /<option[^>]+value="([^"]*)"/i;
      const fm = selMatch[1].match(firstRe);
      return fm ? fm[1] : fallback;
    }

    function getRadioValue(html, radioName) {
      // Find checked radio, or fall back to last radio value (usually "all")
      const checkedRe = new RegExp(`<input[^>]+name="${radioName}"[^>]+checked[^>]+value="([^"]*)"`, 'i');
      const cm = html.match(checkedRe);
      if (cm) return cm[1];
      // Also try checked before value
      const checkedRe2 = new RegExp(`<input[^>]+checked[^>]+name="${radioName}"[^>]+value="([^"]*)"`, 'i');
      const cm2 = html.match(checkedRe2);
      if (cm2) return cm2[1];
      // Fall back: extract all radio values, return last one (usually "all/any")
      const allRe = new RegExp(`<input[^>]+name="${radioName}"[^>]+value="([^"]*)"`, 'gi');
      let last = null, m;
      while ((m = allRe.exec(html)) !== null) last = m[1];
      return last || 'A';
    }

    function getHiddenValue(html, name, fallback) {
      const re = new RegExp(`<input[^>]+name="${name}"[^>]+value="([^"]*)"`, 'i');
      const m = html.match(re);
      return m ? m[1] : fallback;
    }

    // Check if requested term differs from the page's default selected term
    const pageDefaultTerm = getSelectedValue(pageHtml, 'ddlTerm', '');
    let effectiveTcuTerm = tcuTerm;
    let termAvailable = true;

    // Check if requested term exists in TCU's dropdown
    const termSelectRe = /<select[^>]+name="ddlTerm"[^>]*>([\s\S]*?)<\/select>/i;
    const termSelectMatch = pageHtml.match(termSelectRe);
    if (termSelectMatch) {
      const hasOpt = new RegExp(`value="${tcuTerm}"`, 'i').test(termSelectMatch[1]);
      if (!hasOpt) {
        effectiveTcuTerm = pageDefaultTerm || tcuTerm;
        termAvailable = false;
      }
    }

    // Use working HTML state — if term differs from page default, do a postback first
    let activeHtml = pageHtml;
    let activeVS = viewState;
    let activeEV = eventValidation;
    let activeVSG = viewStateGen;
    let didTermPostback = false;
    let postbackHtmlLen = 0;
    let postbackHasVS = false;

    // Helper: build a postback body (like __doPostBack)
    function buildPostbackBody(vs, vsg, ev, html, eventTarget, overrides) {
      const body = new URLSearchParams();
      body.set('__EVENTTARGET', eventTarget);
      body.set('__EVENTARGUMENT', '');
      body.set('__VIEWSTATE', vs);
      body.set('__VIEWSTATEGENERATOR', vsg);
      body.set('__EVENTVALIDATION', ev);
      body.set('ddlTerm', overrides.ddlTerm || getSelectedValue(html, 'ddlTerm', ''));
      body.set('ddlSession', overrides.ddlSession || getSelectedValue(html, 'ddlSession', 'ANY'));
      body.set('ddlLocation', getSelectedValue(html, 'ddlLocation', 'ANY'));
      body.set('ddlSubject', overrides.ddlSubject || getSelectedValue(html, 'ddlSubject', 'ANY'));
      body.set('txtCrsNumber', overrides.txtCrsNumber || '');
      body.set('txtSection', '');
      body.set('ddlAttribute', getSelectedValue(html, 'ddlAttribute', 'ANY'));
      body.set('ddlLevel', getSelectedValue(html, 'ddlLevel', 'ANY'));
      body.set('rbStatus', getRadioValue(html, 'rbStatus'));
      body.set('ddlDay', getSelectedValue(html, 'ddlDay', 'ANY'));
      body.set('ddlStartTime', getSelectedValue(html, 'ddlStartTime', 'ANY'));
      body.set('ddlEndtime', getSelectedValue(html, 'ddlEndtime', 'ANY'));
      body.set('hdnShowBldg', getHiddenValue(html, 'hdnShowBldg', 'Y'));
      return body;
    }

    // Check which dropdowns have AutoPostBack (onchange="__doPostBack(...)")
    function hasAutoPostBack(html, fieldName) {
      const re = new RegExp(`<select[^>]+name="${fieldName}"[^>]*onchange[^>]*__doPostBack`, 'i');
      return re.test(html);
    }

    const termHasAutoPostBack = hasAutoPostBack(pageHtml, 'ddlTerm');
    const subjectHasAutoPostBack = hasAutoPostBack(pageHtml, 'ddlSubject');

    // Shared POST helper with redirect following and cookie preservation
    async function doPost(body) {
      let r = await fetch(postUrl, {
        method: 'POST',
        headers: {
          ...BROWSER_HEADERS,
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: cookieStr(jar),
          Referer: TCU_URL,
          Origin: 'https://classes.tcu.edu',
        },
        body: body.toString(),
        redirect: 'manual',
      });
      collectCookies(r, jar);
      let rc = 0;
      while ([301, 302, 303, 307, 308].includes(r.status) && rc < 5) {
        const loc = r.headers.get('location');
        if (!loc) break;
        r = await fetch(new URL(loc, postUrl).href, {
          headers: { ...BROWSER_HEADERS, Cookie: cookieStr(jar), Referer: TCU_URL },
          redirect: 'manual',
        });
        collectCookies(r, jar);
        rc++;
      }
      return r;
    }

    if (termAvailable && effectiveTcuTerm !== pageDefaultTerm) {
      // Step 2a: Postback to change the term dropdown
      const termPostBody = buildPostbackBody(activeVS, activeVSG, activeEV, activeHtml, 'ddlTerm', {
        ddlTerm: effectiveTcuTerm,
      });

      const termRes = await doPost(termPostBody);
      activeHtml = await termRes.text();
      activeVS = extractHidden(activeHtml, '__VIEWSTATE');
      activeEV = extractHidden(activeHtml, '__EVENTVALIDATION');
      activeVSG = extractHidden(activeHtml, '__VIEWSTATEGENERATOR');
      didTermPostback = true;
      postbackHtmlLen = activeHtml.length;
      postbackHasVS = !!activeVS;
    }

    // Step 2a.5: If subject also has AutoPostBack, do a subject postback too
    let didSubjectPostback = false;
    if (subject !== 'ANY' && subject) {
      const currentSubject = getSelectedValue(activeHtml, 'ddlSubject', 'ANY');
      if (currentSubject !== subject) {
        // Do a subject postback to set the subject before searching
        const subjPostBody = buildPostbackBody(activeVS, activeVSG, activeEV, activeHtml, 'ddlSubject', {
          ddlTerm: effectiveTcuTerm,
          ddlSubject: subject,
          txtCrsNumber: courseNumber,
        });

        const subjRes = await doPost(subjPostBody);
        activeHtml = await subjRes.text();
        activeVS = extractHidden(activeHtml, '__VIEWSTATE');
        activeEV = extractHidden(activeHtml, '__EVENTVALIDATION');
        activeVSG = extractHidden(activeHtml, '__VIEWSTATEGENERATOR');
        didSubjectPostback = true;
      }
    }

    // Step 2b: Build and POST the search form
    function buildSearchBody(vs, vsg, ev, html, termVal) {
      const body = new URLSearchParams();
      body.set('__EVENTTARGET', '');
      body.set('__EVENTARGUMENT', '');
      body.set('__VIEWSTATE', vs);
      body.set('__VIEWSTATEGENERATOR', vsg);
      body.set('__EVENTVALIDATION', ev);
      body.set('ddlTerm', termVal);
      body.set('ddlSession', getSelectedValue(html, 'ddlSession', 'ANY'));
      body.set('ddlLocation', getSelectedValue(html, 'ddlLocation', 'ANY'));
      body.set('ddlSubject', subject);
      body.set('txtCrsNumber', courseNumber);
      body.set('txtSection', '');
      body.set('ddlAttribute', getSelectedValue(html, 'ddlAttribute', 'ANY'));
      body.set('ddlLevel', getSelectedValue(html, 'ddlLevel', 'ANY'));
      body.set('rbStatus', getRadioValue(html, 'rbStatus'));
      body.set('ddlDay', getSelectedValue(html, 'ddlDay', 'ANY'));
      body.set('ddlStartTime', getSelectedValue(html, 'ddlStartTime', 'ANY'));
      body.set('ddlEndtime', getSelectedValue(html, 'ddlEndtime', 'ANY'));
      body.set(searchBtnName, 'Search');
      body.set('hdnShowBldg', getHiddenValue(html, 'hdnShowBldg', 'Y'));
      return body;
    }

    const formBody = buildSearchBody(activeVS, activeVSG, activeEV, activeHtml, effectiveTcuTerm);
    let postRes = await doPost(formBody);
    let resultHtml = await postRes.text();

    // If the term differs from the page default and we got no results,
    // ASP.NET may have processed the term change but not the search.
    // Re-submit the search using the new page's ViewState (double-search).
    let didDoubleSearch = false;
    if (termAvailable && effectiveTcuTerm !== pageDefaultTerm && !/<TABLE[^>]*class="results"/i.test(resultHtml)) {
      const vs2 = extractHidden(resultHtml, '__VIEWSTATE');
      const ev2 = extractHidden(resultHtml, '__EVENTVALIDATION');
      const vsg2 = extractHidden(resultHtml, '__VIEWSTATEGENERATOR');
      if (vs2) {
        const formBody2 = buildSearchBody(vs2, vsg2, ev2, resultHtml, effectiveTcuTerm);
        const postRes2 = await doPost(formBody2);
        resultHtml = await postRes2.text();
        postRes = postRes2;
        didDoubleSearch = true;
      }
    }

    // Step 3: Parse the HTML results table
    const sections = parseResultsTable(resultHtml);

    const termOptions = debug ? getSelectOptions(pageHtml, termFieldName) : null;
    const subjectOptions = debug ? getSelectOptions(pageHtml, subjectFieldName) : null;

    const debugInfo = debug
      ? {
          _debug: {
            step1_status: getRes.status,
            step1_html_length: pageHtml.length,
            viewStateFound: !!viewState,
            viewStateLen: viewState.length,
            eventValidationFound: !!eventValidation,
            cookieCount: jar.size,
            formAction,
            postUrl,
            allFields,
            termFieldName,
            subjectFieldName,
            searchBtnName,
            postedFields: [...formBody.keys()],
            tcuTermRequested: tcuTerm,
            tcuTermUsed: effectiveTcuTerm,
            pageDefaultTerm,
            termAvailable,
            didTermPostback,
            postbackHtmlLen,
            postbackHasVS,
            postbackSelectedTerm: didTermPostback ? getSelectedValue(activeHtml, 'ddlTerm', 'unknown') : 'N/A',
            termHasAutoPostBack,
            subjectHasAutoPostBack,
            didSubjectPostback,
            didDoubleSearch,
            formSubject: subject,
            termOptions,
            subjectOptions,
            step2_status: postRes.status,
            step2_html_length: resultHtml.length,
            hasResultsTable: /<TABLE[^>]*class="results"/i.test(resultHtml),
            step2_snippet: resultHtml.slice(0, 2000),
            step2_end_snippet: resultHtml.slice(-1500),
          },
        }
      : {};

    const termNote = !termAvailable
      ? `Note: ${appTerm.slice(4,6)==='90'?'Fall':appTerm.slice(4,6)==='50'?'Summer':'Spring'} ${appTerm.slice(0,4)} is not yet available on classes.tcu.edu. Showing results for the closest available term.`
      : null;

    if (sections.length === 0) {
      // Check if there's an error message in the page
      const msgMatch = resultHtml.match(
        /class="error[^"]*"[^>]*>([\s\S]*?)<\//i,
      );
      const noResultsMatch = resultHtml.match(
        /No classes were found/i,
      );

      let detail = noResultsMatch
        ? 'No classes were found matching your search criteria.'
        : msgMatch
          ? stripTags(msgMatch[1])
          : `No results found (HTTP ${postRes.status}).`;
      if (termNote) detail = termNote;

      return res.status(200).json({
        sections: [],
        totalCount: 0,
        term: appTerm,
        termAvailable,
        detail,
        ...debugInfo,
      });
    }

    return res.status(200).json({
      sections,
      totalCount: sections.length,
      term: appTerm,
      termAvailable,
      ...(termNote && { termNote }),
      ...debugInfo,
    });
  } catch (err) {
    return res.status(502).json({
      detail: `Failed to reach classes.tcu.edu: ${err.message || 'Unknown error'}`,
    });
  }
};
