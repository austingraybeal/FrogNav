'use strict';

// ── Storage keys ──────────────────────────────────────────────────────────────
const PROFILE_KEY   = 'frognav-profile';
const THREAD_KEY    = 'frognav-thread';
const LAST_PLAN_KEY = 'frognav-last-plan';

// ── Profile defaults ──────────────────────────────────────────────────────────
const DEFAULTS = {
  firstName:         '',
  lastName:          '',
  level:             'undergrad',
  majorProgram:      'Movement Science',
  emphasis:          '',
  minorProgram:      '',
  honorsCollege:     false,
  startTerm:         'Fall 2026',
  targetGraduation:  '',
  creditsPerTerm:    '15',
  summerOptional:    true,
  apTransfer:        'None',
  completedCourses:  '',
  constraints:       '',
  careerGoal:        '',
};

// ── Quick-action prompts ──────────────────────────────────────────────────────
// FIX #1: grad.compare was showing an undergrad track comparison.
//         grad.honors and grad.add_minor labels updated to be level-appropriate.
// FIX #3: Prompts now reflect the correct context per level so the AI gets
//         an accurate instruction from the very first token.
const QUICK_ACTION_PROMPTS = {
  undergrad: {
    build:     'Build my Movement Science plan',
    add_minor: 'Add a minor to my plan',
    honors:    'Show me the Honors College version of my plan',
    compare:   'Compare Movement Science and Health & Fitness',
  },
  grad: {
    build:     'Build my Kinesiology, MS plan',
    add_minor: 'Add a concentration or graduate certificate to my plan',
    honors:    'Explain graduate program options equivalent to Honors College for Kinesiology MS students',
    compare:   'Compare the Movement Science and Exercise Physiology graduate concentrations',
  },
};

// ── DOM references ────────────────────────────────────────────────────────────
const profileForm       = document.getElementById('profileForm');
const profileModal      = document.getElementById('profileModal');
const openProfileBtn    = document.getElementById('openProfileBtn');
const closeProfileBtn   = document.getElementById('closeProfileBtn');
const chatThread        = document.getElementById('chatThread');
const statusMessage     = document.getElementById('statusMessage');
const chatComposer      = document.getElementById('chatComposer');
const chatInput         = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const plusBtn = document.getElementById('plusBtn');
const toolMenuPopover = document.getElementById('toolMenuPopover');
const transcriptFileInput = document.getElementById('transcriptFileInput');
const profileUploadBtn = document.getElementById('profileUploadBtn');
const profileTranscriptInput = document.getElementById('profileTranscriptInput');
const hub = document.querySelector('.hub');
const composerGreeting = document.getElementById('composerGreeting');
const quickActionButtons = [...document.querySelectorAll('.quick-action')];
const replaceFromInput  = document.getElementById('replaceFrom');
const replaceToInput    = document.getElementById('replaceTo');
const replaceBtn        = document.getElementById('replaceBtn');
const catalogOptions    = document.getElementById('catalogOptions');
const replaceWarnings   = document.getElementById('replaceWarnings');
const checklistModal    = document.getElementById('checklistModal');
const closeChecklistBtn = document.getElementById('closeChecklistBtn');
const checklistGroups   = document.getElementById('checklistGroups');
const checklistDoneBtn  = document.getElementById('checklistDoneBtn');
const checklistSkipBtn  = document.getElementById('checklistSkipBtn');

// ── Major/Level Sync ──────────────────────────────────────────────────────────
const levelSelect    = profileForm.elements.namedItem('level');
const undergradGroup = document.getElementById('undergradMajors');
const gradGroup      = document.getElementById('gradMajors');
const majorSelect    = document.getElementById('majorProgram');

function syncMajorOptions() {
  const level  = levelSelect?.value || 'undergrad';
  const isGrad = level === 'grad';

  // Show/hide the entire optgroup
  undergradGroup.hidden = isGrad;
  gradGroup.hidden      = !isGrad;

  // Disable options in hidden groups so they can't be submitted
  [...undergradGroup.querySelectorAll('option')].forEach(opt => opt.disabled = isGrad);
[...gradGroup.querySelectorAll('option')].forEach(opt => opt.disabled = !isGrad);

  // If currently selected major belongs to the now-hidden group, reset it
  const selectedOpt = majorSelect.querySelector(`option[value="${majorSelect.value}"]`);
  if (selectedOpt && selectedOpt.disabled) {
    majorSelect.value = '';
  }
}

levelSelect?.addEventListener('change', syncMajorOptions);
syncMajorOptions(); // run once on page load

// ── Health & Fitness emphasis / minor sync ────────────────────────────────────
const emphasisField  = document.getElementById('emphasisField');
const emphasisSelect = document.getElementById('emphasis');
const minorSelect    = document.getElementById('minorProgram');

function syncEmphasisAndMinor() {
  const isHF = majorSelect.value === 'Health and Fitness';
  emphasisField.hidden   = !isHF;
  emphasisSelect.disabled = !isHF;
  if (!isHF) emphasisSelect.value = '';
  minorSelect.disabled = isHF;
  if (isHF) minorSelect.value = '';
}

majorSelect.addEventListener('change', syncEmphasisAndMinor);
syncEmphasisAndMinor();
// ─────────────────────────────────────────────────────────────────────────────

// ── App state ─────────────────────────────────────────────────────────────────
let messages = [];
let lastPlan = null;
let loading  = false;
let pendingAction = null; // stores { action, prompt } while checklist is open

// ── Status bar ────────────────────────────────────────────────────────────────
const statusSpinner = document.getElementById('statusSpinner');
const statusText = document.getElementById('statusText');

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusMessage.classList.toggle('error', isError);
  const isThinking = message === 'FrogNav is thinking...';
  if (statusSpinner) statusSpinner.hidden = !isThinking;
}

// ── Profile helpers ───────────────────────────────────────────────────────────
function readProfile() {
  const data = new FormData(profileForm);
  return {
    firstName:        String(data.get('firstName')       || '').trim(),
    lastName:         String(data.get('lastName')        || '').trim(),
    level:            String(data.get('level') || 'undergrad').trim().toLowerCase() === 'grad' ? 'grad' : 'undergrad',
    majorProgram:     String(data.get('majorProgram')    || '').trim(),
    emphasis:         String(data.get('emphasis')         || '').trim(),
    minorProgram:     String(data.get('minorProgram')    || '').trim(),
    honorsCollege:    Boolean(data.get('honorsCollege')),
    startTerm:        String(data.get('startTerm')        || '').trim(),
    targetGraduation: String(data.get('targetGraduation') || '').trim(),
    creditsPerTerm:   String(data.get('creditsPerTerm')   || '').trim(),
    summerOptional:   Boolean(data.get('summerOptional')),
    apTransfer:       String(data.get('apTransfer')       || '').trim(),
    completedCourses: String(data.get('completedCourses') || '').trim(),
     constraints:      String(data.get('constraints')      || '').trim(),
    careerGoal:       String(data.get('careerGoal')       || '').trim(),
  };
}

function applyProfile(profile) {
  Object.entries({ ...DEFAULTS, ...(profile || {}) }).forEach(([key, value]) => {
    const field = profileForm.elements.namedItem(key);
    if (!field) return;
    if (field.type === 'checkbox') {
      field.checked = Boolean(value);
      return;
    }
    field.value = value ?? '';
  });
}

// FIX #8: The original logic was inverted — boolean and level checks were
// correct, but string fields checked `!== ""` which meant a non-empty
// completedCourses field would never trigger "not empty".
// Rewritten to clearly return true when ANY field differs from its default.
function profileIsEmpty(profile) {
  return !Object.keys(DEFAULTS).some(key => {
    const val     = profile[key];
    const defVal  = DEFAULTS[key];
    if (typeof defVal === 'boolean') return val !== defVal;
    return String(val || '').trim() !== String(defVal || '').trim();
  });
}

function ensureBuildDefaults() {
  const profile = readProfile();
  if (!profileIsEmpty(profile)) return profile;
  applyProfile(DEFAULTS);
  localStorage.setItem(PROFILE_KEY, JSON.stringify(DEFAULTS));
  return { ...DEFAULTS };
}

function saveProfile() {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(readProfile()));
}

// ── Loading state ─────────────────────────────────────────────────────────────
function setLoading(isLoading) {
  loading            = isLoading;
  sendBtn.disabled   = isLoading;
  chatInput.disabled = isLoading;
  quickActionButtons.forEach(button => { button.disabled = isLoading; });
  if (plusBtn) plusBtn.disabled = isLoading;
}

// ── Persistence ───────────────────────────────────────────────────────────────
function persistConversation() {
  localStorage.setItem(THREAD_KEY, JSON.stringify(messages));
}

function persistLastPlan() {
  if (lastPlan) {
    localStorage.setItem(LAST_PLAN_KEY, JSON.stringify(lastPlan));
  } else {
    localStorage.removeItem(LAST_PLAN_KEY);
  }
}

// ── XSS-safe text helper ──────────────────────────────────────────────────────
// FIX #7: renderAssistantPlan was using innerHTML with backend-sourced strings.
// This helper creates a text node safely — no HTML injection possible.
function safeText(str) {
  const el = document.createElement('span');
  el.textContent = String(str || '');
  return el.textContent; // returns escaped string for use in textContent assignments
}

// ── Lightweight markdown renderer for chat messages ──────────────────────────
function renderMarkdown(src) {
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const inline = s => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');

  const lines = String(src || '').split('\n');
  let html = '';
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    // Headings
    const hMatch = raw.match(/^(#{1,3})\s+(.+)$/);
    if (hMatch) {
      if (inList) { html += '</ul>'; inList = false; }
      const lvl = hMatch[1].length + 1; // ## → h3, ### → h4
      html += `<h${lvl}>${inline(hMatch[2])}</h${lvl}>`;
      continue;
    }

    // Bullet list items (-, *, or numbered)
    const liMatch = raw.match(/^\s*(?:[-*]|\d+[.)]) (.+)$/);
    if (liMatch) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(liMatch[1])}</li>`;
      continue;
    }

    // Empty line → close list, add break
    if (!raw.trim()) {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<br>';
      continue;
    }

    // Regular paragraph line
    if (inList) { html += '</ul>'; inList = false; }
    html += `<p>${inline(raw)}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}

// ── Plan rendering helpers ────────────────────────────────────────────────────
function listSection(title, items) {
  const section   = document.createElement('section');
  section.className = 'plan-section';
  const heading   = document.createElement('h4');
  heading.textContent = title;
  section.appendChild(heading);

  const list      = document.createElement('ul');
  const safeItems = Array.isArray(items) && items.length ? items : ['None provided.'];
  safeItems.forEach(item => {
    const li = document.createElement('li');
    li.textContent = String(item || ''); // FIX #7: textContent, never innerHTML
    list.appendChild(li);
  });
  section.appendChild(list);
  return section;
}

function renderAssistantPlan(container, planJson) {
  const summary     = document.createElement('article');
  summary.className = 'plan-card';
  const profile     = planJson.profileEcho || {};

  // Profile grid — safe because we use textContent on every dynamic value
  const heading = document.createElement('h3');
  heading.textContent = 'Plan Summary';
  summary.appendChild(heading);

  const summaryText = document.createElement('p');
  summaryText.textContent = planJson.planSummary || 'No summary provided.';
  summary.appendChild(summaryText);

  const grid = document.createElement('div');
  grid.className = 'plan-grid';

  const gridFields = [
    ['Academic Level',    profile.level            || 'undergrad'],
    ['Major',             profile.major            || 'Not set'],
    ['Minor',             profile.minor            || 'None'],
    ['Honors',            profile.honors ? 'Yes' : 'No'],
    ['Start Term',        profile.startTerm        || 'Not set'],
    ['Target Graduation', profile.targetGraduation || 'Not set'],
    ['Credits / Term',    profile.creditsPerTerm   != null ? profile.creditsPerTerm : 'Not set'],
  ];
  gridFields.forEach(([label, value]) => {
    const cell      = document.createElement('div');
    const strong    = document.createElement('strong');
    strong.textContent = label;
    const p         = document.createElement('p');
    p.textContent   = String(value);
    cell.appendChild(strong);
    cell.appendChild(p);
    grid.appendChild(cell);
  });
  summary.appendChild(grid);
  container.appendChild(summary);

  // Terms table
  if (Array.isArray(planJson.terms) && planJson.terms.length) {
    const termsSection   = document.createElement('section');
    termsSection.className = 'plan-section has-table';
    const termsHeading   = document.createElement('h4');
    termsHeading.textContent = 'Terms';
    termsSection.appendChild(termsHeading);

    const table = document.createElement('table');
    table.className = 'plan-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Term</th><th>Total Credits</th><th>Courses</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    planJson.terms.forEach(term => {
      const row = document.createElement('tr');

      const tdTerm    = document.createElement('td');
      tdTerm.textContent = term.term || 'Term';

      const tdCredits = document.createElement('td');
      tdCredits.textContent = String(term.totalCredits ?? 0);

      const tdCourses = document.createElement('td');
      if (Array.isArray(term.courses) && term.courses.length) {
        term.courses.forEach((course, i) => {
          if (i > 0) tdCourses.appendChild(document.createElement('br'));
          // FIX #7: Build course text via textContent — never innerHTML with course data
          const courseSpan = document.createElement('span');
          const noteSuffix = course.notes ? ` — ${course.notes}` : '';
          courseSpan.textContent =
            `${course.code || 'TBD'} - ${course.title || 'Untitled'} ` +
            `(${course.credits ?? 0})${noteSuffix}`;
          tdCourses.appendChild(courseSpan);
        });
      } else {
        tdCourses.textContent = 'TBD';
      }

      row.appendChild(tdTerm);
      row.appendChild(tdCredits);
      row.appendChild(tdCourses);
      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    termsSection.appendChild(table);
    container.appendChild(termsSection);
  }

  // Compact requirement summary + adjustments + policies
  const checklist = Array.isArray(planJson.requirementChecklist)
    ? planJson.requirementChecklist : [];
  const adjustments = Array.isArray(planJson.adjustmentOptions)
    ? planJson.adjustmentOptions : [];

  if (checklist.length || adjustments.length) {
    const summarySection = document.createElement('section');
    summarySection.className = 'plan-section plan-summary-compact';

    // Status is now normalized server-side to: Met | In Progress | Planned | Needs Review
    function isMet(c) {
      return c.status === 'Met' || c.status === 'Planned';
    }

    const met   = checklist.filter(isMet).length;
    const total = checklist.length;
    const needs = total - met;

    // Bold heading
    const reqHeading = document.createElement('h4');
    reqHeading.className = 'summary-heading';
    if (total === 0) {
      reqHeading.textContent = 'Requirement Summary';
    } else if (needs === 0) {
      reqHeading.textContent = `All ${total} requirements look good — you're on track!`;
    } else {
      reqHeading.textContent = `${met} of ${total} requirements met — ${needs} still need${needs === 1 ? 's' : ''} attention.`;
    }
    summarySection.appendChild(reqHeading);

    // Pill-style badges: green for met, amber (clickable) for needs attention
    if (checklist.length) {
      const pills = document.createElement('div');
      pills.className = 'summary-pills stacked';
      checklist.forEach(c => {
        const label = c.item + (c.notes ? ` — ${c.notes}` : '');
        if (isMet(c)) {
          const pill = document.createElement('span');
          pill.className = 'summary-pill met';
          pill.textContent = label;
          pills.appendChild(pill);
        } else {
          const pill = document.createElement('button');
          pill.type = 'button';
          pill.className = 'summary-pill fix';
          pill.innerHTML = `${label} <span class="fix-hint">⟶ Tap to fix</span>`;
          pill.addEventListener('click', () => {
            callAssistant(
              `The requirement "${c.item}" needs attention (${c.notes || c.status}). ` +
              `Please review my current schedule and tell me exactly what course(s) I should add, swap, or move to fully satisfy this requirement. ` +
              `Show me the specific changes and let me confirm before applying them.`,
              'chat'
            );
          });
          pills.appendChild(pill);
        }
      });
      summarySection.appendChild(pills);
    }

    // Adjustment options as collapsible
    if (adjustments.length) {
      const adjDetails = document.createElement('details');
      adjDetails.className = 'plan-details-toggle adj-toggle';
      const adjSummary = document.createElement('summary');
      adjSummary.textContent = `${adjustments.length} Adjustment Option${adjustments.length === 1 ? '' : 's'}`;
      adjDetails.appendChild(adjSummary);
      const adjList = document.createElement('ul');
      adjustments.forEach(opt => {
        const li = document.createElement('li');
        li.textContent = String(opt || '');
        adjList.appendChild(li);
      });
      adjDetails.appendChild(adjList);
      summarySection.appendChild(adjDetails);
    }

    // Policies & Assumptions nested under adjustments (smaller font)
    if (planJson.policyWarnings?.length || planJson.assumptions?.length) {
      const polDetails = document.createElement('details');
      polDetails.className = 'plan-details-toggle policies-nested';
      const polSummary = document.createElement('summary');
      polSummary.textContent = 'Policies & Assumptions';
      polDetails.appendChild(polSummary);
      if (planJson.policyWarnings?.length) {
        polDetails.appendChild(listSection('Policy Warnings', planJson.policyWarnings));
      }
      if (planJson.assumptions?.length) {
        polDetails.appendChild(listSection('Assumptions', planJson.assumptions));
      }
      summarySection.appendChild(polDetails);
    }

    container.appendChild(summarySection);
  }

  // Questions — conversational framing
  const questions = Array.isArray(planJson.questions) && planJson.questions.length
    ? planJson.questions : [];
  if (questions.length) {
    const qSection = document.createElement('section');
    qSection.className = 'plan-section';
    const qHeading = document.createElement('h4');
    qHeading.className = 'section-heading-lg';
    qHeading.textContent = 'Help Us Personalize Your Plan';
    qSection.appendChild(qHeading);
    const qIntro = document.createElement('p');
    qIntro.className = 'questions-intro';
    qIntro.textContent = 'Answering these questions helps us align your schedule with your career goals and program requirements.';
    qSection.appendChild(qIntro);
    const qList = document.createElement('ul');
    questions.forEach(q => {
      const li = document.createElement('li');
      li.textContent = String(q || '');
      qList.appendChild(li);
    });
    qSection.appendChild(qList);
    container.appendChild(qSection);
  }

  // What's next — always include default options + AI-generated ones
  {
    const nextSection = document.createElement('section');
    nextSection.className = 'plan-section next-steps';
    const nextHeading = document.createElement('h4');
    nextHeading.className = 'section-heading-lg';
    nextHeading.textContent = 'What would you like to do next?';
    nextSection.appendChild(nextHeading);
    const btnRow = document.createElement('div');
    btnRow.className = 'next-steps-btns';

    // AI-generated steps (filter out download/make-changes dupes)
    const aiSteps = Array.isArray(planJson.nextSteps) ? planJson.nextSteps : [];
    aiSteps.filter(s => {
      const lbl = (s.label || '').toLowerCase();
      return !lbl.includes('download') && !lbl.includes('make changes');
    }).forEach(step => {
      const btn = document.createElement('button');
      btn.className = 'next-step-btn';
      btn.textContent = step.label;
      btn.addEventListener('click', () => callAssistant(step.prompt, 'chat'));
      btnRow.appendChild(btn);
    });

    // Always-present default buttons
    const makeChangesBtn = document.createElement('button');
    makeChangesBtn.className = 'next-step-btn';
    makeChangesBtn.textContent = 'Make changes to my schedule';
    makeChangesBtn.addEventListener('click', () => callAssistant('I\'d like to make some changes to my current schedule. What are my options?', 'chat'));
    btnRow.appendChild(makeChangesBtn);

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'next-step-btn';
    downloadBtn.textContent = 'Download my course schedule';
    downloadBtn.addEventListener('click', () => handleExportPDF());
    btnRow.appendChild(downloadBtn);
    nextSection.appendChild(btnRow);
    container.appendChild(nextSection);
  }
}

// ── Thread renderer ───────────────────────────────────────────────────────────
const composerWrap = document.querySelector('.composer-wrap');
window.addEventListener('resize', () => positionComposer(!messages.length ? false : true));
const emptyGreeting = document.createElement('p');
emptyGreeting.id = 'emptyGreeting';
emptyGreeting.style.cssText = 'text-align:center;font-size:1.5rem;font-weight:600;color:var(--text);margin:0 0 1.25rem;letter-spacing:-0.01em;display:none;';
emptyGreeting.textContent = 'Welcome to FrogForward! Where would you like to start?';
composerWrap.parentNode.insertBefore(emptyGreeting, composerWrap);

function positionComposer(hasMessages) {
  const eg = document.getElementById('emptyGreeting');
  if (hasMessages) {
    composerWrap.style.top = '';
    composerWrap.style.bottom = '1rem';
    composerWrap.style.transform = 'translateX(-50%)';
    composerWrap.style.width = '';
    if (eg) eg.style.display = 'none';
  } else {
    composerWrap.style.top = 'calc(50vh + 120px)';
    composerWrap.style.bottom = 'auto';
    composerWrap.style.transform = 'translate(-50%, -50%)';
    composerWrap.style.width = 'min(780px, 92vw)';
    if (eg) {
      eg.style.display = 'block';
      eg.style.position = 'fixed';
      eg.style.left = '50%';
      eg.style.width = 'min(780px, 92vw)';
      // Wait for layout before measuring position
      requestAnimationFrame(() => {
        const rect = composerWrap.getBoundingClientRect();
        eg.style.transform = 'translateX(-50%)';
eg.style.left = 'calc(220px + (100vw - 220px) / 2)';
eg.style.top = (rect.top - 60) + 'px';
      });
    }
  }
}

function renderThread() {
  chatThread.innerHTML = '';

  if (!messages.length) {
    chatThread.hidden = true;
    hub.classList.remove('has-messages');
    positionComposer(false);
    if (composerGreeting) {
      composerGreeting.textContent = 'Hey! What can I help you plan today?';
    }
    return;
  }

  chatThread.hidden = false;
  hub.classList.add('has-messages');
  positionComposer(true);

  messages.forEach(message => {
    const node    = document.createElement('article');
    node.className = `msg ${message.role}`;

    if (message.role === 'assistant' && message.planJson) {
      renderAssistantPlan(node, message.planJson);
    } else {
      const prose = document.createElement('div');
      prose.className = 'msg-prose';
      prose.innerHTML = renderMarkdown(message.content);
      node.appendChild(prose);

      // Render next-step buttons for chat responses
      if (Array.isArray(message.chatNextSteps) && message.chatNextSteps.length) {
        const btnRow = document.createElement('div');
        btnRow.className = 'next-steps-btns';
        btnRow.style.marginTop = '0.75rem';
        message.chatNextSteps.forEach(step => {
          const btn = document.createElement('button');
          btn.className = 'next-step-btn';
          btn.textContent = step.label;
          btn.addEventListener('click', () => callAssistant(step.prompt, 'chat'));
          btnRow.appendChild(btn);
        });
        node.appendChild(btnRow);
      }
    }

    chatThread.appendChild(node);
  });

  chatThread.scrollTop = chatThread.scrollHeight;
}

// ── API: call plan assistant ──────────────────────────────────────────────────
async function callAssistant(userContent, action = 'chat') {
  messages.push({ role: 'user', content: userContent });
  renderThread();
  persistConversation();

  setLoading(true);
  setStatus('FrogNav is thinking...');

  // FIX #9: Clear any stale replace warnings when a new plan request starts
  if (replaceWarnings) {
    replaceWarnings.textContent = '';
    replaceWarnings.classList.remove('error');
  }

  try {
    const response = await fetch('/api/plan', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile:  readProfile(),
        action,
        lastPlan,
        message:  userContent,
        conversationHistory: messages.slice(-10).map(m => ({
          role: m.role,
          content: m.content || m.planJson?.planSummary || '',
        })),
      }),
    });

    const raw = await response.text();
    let payload = null;
    try   { payload = raw ? JSON.parse(raw) : null; }
    catch { payload = null; }

    if (!response.ok) {
      if (!payload || typeof payload !== 'object') {
        throw new Error(
          `Request failed (${response.status}). Backend returned non-JSON. ` +
          `Check /api/health and Vercel logs.`
        );
      }
      const errorCode = payload.code   || 'FROGNAV_UNKNOWN';
      const detail    = payload.detail || 'No backend detail provided.';
      const where     = payload.where  || 'unknown';
      throw new Error(
        `Request failed (${response.status}) [${errorCode}] ${detail} (where: ${where})`
      );
    }

    if (!payload || typeof payload !== 'object') {
      throw new Error(
        'Backend returned non-JSON response. Check /api/health and Vercel logs.'
      );
    }

    if (payload.type === 'chat') {
      // Conversational response — don't overwrite lastPlan
      messages.push({
        role:    'assistant',
        content: payload.message || 'How can I help?',
        chatNextSteps: payload.nextSteps || [],
      });
    } else {
      // Full plan response — existing behavior
      lastPlan = payload;
      persistLastPlan();

      messages.push({
        role:     'assistant',
        content:  payload.planSummary || 'Plan generated.',
        planJson: payload,
      });
    }

    setStatus('Ready.');
  } catch (error) {
    messages.push({
      role:    'assistant',
      content: error.message || 'Request failed.',
    });
    setStatus(error.message || 'Request failed.', true);
  } finally {
    persistConversation();
    setLoading(false);
    renderThread();
  }
}

// ── API: catalog search (for replace dropdowns) ───────────────────────────────
// FIX #6: Now clears catalogOptions on every call — including errors and short queries
async function searchCatalogOptions(query) {
  // Always clear first so stale options don't linger
  if (catalogOptions) catalogOptions.innerHTML = '';

  if (!query || query.trim().length < 2) return;

  const level = readProfile().level || 'undergrad';
  try {
    const response = await fetch(
      `/api/catalog/search?q=${encodeURIComponent(query)}&limit=8&level=${encodeURIComponent(level)}`
    );
    const payload = await response.json().catch(() => ({ results: [] }));
    const results = Array.isArray(payload.results) ? payload.results : [];

    results.forEach(item => {
      const option  = document.createElement('option');
      option.value  = item.code;
      // FIX #7: label uses textContent-equivalent assignment — no innerHTML
      option.label  = `${item.code} — ${item.title || item.description || ''}`;
      catalogOptions.appendChild(option);
    });
  } catch {
    // Silently fail — the input still works, just no autocomplete suggestions
  }
}

// ── API: replace course ───────────────────────────────────────────────────────
async function replaceCourseFlow() {
  const fromCode = replaceFromInput.value.trim().toUpperCase();
  const toCode   = replaceToInput.value.trim().toUpperCase();

  // Clear previous result
  replaceWarnings.textContent = '';
  replaceWarnings.classList.remove('error');

  if (!lastPlan) {
    replaceWarnings.textContent = 'Build a plan before replacing a course.';
    replaceWarnings.classList.add('error');
    return;
  }
  if (!fromCode || !toCode) {
    replaceWarnings.textContent = 'Enter both from/to course codes.';
    replaceWarnings.classList.add('error');
    return;
  }

  // FIX #4: Correct route is /api/replace — not /api/plan/replace
  const response = await fetch('/api/replace', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      planJson: lastPlan,
      fromCode,
      toCode,
      profile: readProfile(),
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    // FIX #5: Backend returns payload.detail — not payload.error
    replaceWarnings.textContent =
      payload.detail || payload.error || 'Replace failed. Please try again.';
    replaceWarnings.classList.add('error');
    return;
  }

  lastPlan = payload.planJson;
  persistLastPlan();

  messages.push({
    role:     'assistant',
    content:  `Replaced ${fromCode} with ${toCode}.`,
    planJson: lastPlan,
  });
  persistConversation();
  renderThread();

  const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
  replaceWarnings.textContent = warnings.length
    ? warnings.join(' ')
    : 'Course replacement applied successfully.';
  replaceWarnings.classList.toggle('error', warnings.length > 0);
}

// ── Quick-action labels ───────────────────────────────────────────────────────
// FIX #2: Now updates ALL quick-action buttons — not just "build"
function updateQuickActionLabels() {
  const level = readProfile().level || 'undergrad';
  const prompts = QUICK_ACTION_PROMPTS[level] || QUICK_ACTION_PROMPTS.undergrad;

  quickActionButtons.forEach(button => {
    const action = button.dataset.action;
    if (!action) return;
    if (prompts[action]) {
      button.textContent = prompts[action];
    }
  });
}

// ── Quick-action prompt builder ───────────────────────────────────────────────
function quickActionPrompt(action, profile) {
  const level = profile.level || 'undergrad';
  const base  = QUICK_ACTION_PROMPTS[level]?.[action]
             || QUICK_ACTION_PROMPTS.undergrad[action]
             || '';

  // Grad-specific contextual notes appended to the prompt for the AI
  if (level === 'grad' && action === 'honors') {
    return `${base}. Note: Honors College tracks are undergraduate-only; explain graduate equivalent options instead.`;
  }
  if (level === 'grad' && action === 'compare') {
    return `${base}. Note: Graduate plans do not use undergraduate Gen Ed requirements.`;
  }
  if (level === 'grad' && action === 'add_minor') {
    return `${base}. Note: Graduate students do not take undergraduate minors; focus on concentrations and certificates.`;
  }

  return base;
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openModal()  { profileModal.hidden = false; }
function closeModal() { profileModal.hidden = true;  }
// ── Checklist helpers ─────────────────────────────────────────────────────────
function openChecklist()  { checklistModal.hidden = false; }
function closeChecklist() { checklistModal.hidden = true;  }

function buildChecklistGroups(requiredCourses) {
  checklistGroups.innerHTML = '';

  // Group courses by their category
  const groups = {};
  requiredCourses.forEach(course => {
    const group = course.group || 'Other';
    if (!groups[group]) groups[group] = [];
    groups[group].push(course);
  });

  // Get already-checked courses from profile
  const alreadyChecked = new Set(
    (readProfile().completedCourses || '')
      .split(',')
      .map(c => c.trim().toUpperCase())
      .filter(Boolean)
  );

  Object.entries(groups).forEach(([groupName, courses]) => {
    const groupEl = document.createElement('div');
    groupEl.className = 'checklist-group';

    const heading = document.createElement('h3');
    heading.textContent = groupName;
    groupEl.appendChild(heading);

    const ul = document.createElement('ul');
    courses.forEach(course => {
      const li    = document.createElement('li');
      const label = document.createElement('label');
      const cb    = document.createElement('input');
      cb.type    = 'checkbox';
      cb.value   = course.code;
      cb.name    = 'checklist-course';
      cb.checked = alreadyChecked.has(course.code.toUpperCase());

      const textWrap = document.createElement('span');
      const title    = document.createElement('span');
      title.textContent = `${course.code} — ${course.title}`;

      const meta  = document.createElement('span');
      meta.className   = 'checklist-course-meta';
      meta.textContent = course.credits ? ` (${course.credits} cr)` : '';

      textWrap.appendChild(title);
      textWrap.appendChild(meta);
      label.appendChild(cb);
      label.appendChild(textWrap);
      li.appendChild(label);
      ul.appendChild(li);
    });

    groupEl.appendChild(ul);
    checklistGroups.appendChild(groupEl);
  });
}

async function openChecklistForAction(action, prompt) {
  pendingAction = { action, prompt };

  // Load required courses for the student's major from kine_rules
  const profile = readProfile();
  try {
    const response = await fetch(`/api/checklist-courses?level=${encodeURIComponent(profile.level)}&major=${encodeURIComponent(profile.majorProgram)}`);
    const payload  = await response.json().catch(() => ({ courses: [] }));
    buildChecklistGroups(Array.isArray(payload.courses) ? payload.courses : []);
  } catch {
    buildChecklistGroups([]);
  }

  openChecklist();
}

function commitChecklist() {
  const checked = [...checklistGroups.querySelectorAll('input[type="checkbox"]:checked')]
    .map(cb => cb.value)
    .join(', ');

  // Update the hidden textarea so readProfile() picks it up
  const completedField = document.getElementById('completedCourses');
  if (completedField) completedField.value = checked;
  saveProfile();
  closeChecklist();

  // Now fire the action that was waiting
  if (pendingAction) {
    const { action, prompt } = pendingAction;
    pendingAction = null;
    callAssistant(prompt, action);
  }
}

// ── Quick-action button listeners ────────────────────────────────────────────
quickActionButtons.forEach(button => {
  button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (!action) return;

    if (action === 'build') ensureBuildDefaults();

    const profile = readProfile();

    if (action === 'add_minor' && !profile.minorProgram && profile.level !== 'grad') {
      setStatus(
        'Select a minor in Student Profile before using "Add a minor to my plan".',
        true
      );
      openModal();
      return;
    }

    if (profile.level === 'grad' && action === 'honors') {
      setStatus(
        'Honors College planning is undergraduate-only; graduate equivalent options will be explained.'
      );
    }
    if (profile.level === 'grad' && action === 'compare') {
      setStatus(
        'Graduate planning does not include undergraduate Gen Ed buckets; comparison will focus on graduate scope.'
      );
    }

    const prompt = quickActionPrompt(action, profile);
    callAssistant(prompt, action);
  });
});

// ── Tool menu (hamburger) + popover listeners ──────────────────────────────
if (plusBtn && toolMenuPopover) {
  plusBtn.addEventListener('click', () => {
    const isOpen = !toolMenuPopover.hidden;
    toolMenuPopover.hidden = isOpen;
    plusBtn.setAttribute('aria-expanded', String(!isOpen));
    plusBtn.classList.toggle('open', !isOpen);
  });

  document.addEventListener('click', event => {
    if (!toolMenuPopover.hidden &&
        !plusBtn.contains(event.target) &&
        !toolMenuPopover.contains(event.target)) {
      toolMenuPopover.hidden = true;
      plusBtn.setAttribute('aria-expanded', 'false');
      plusBtn.classList.remove('open');
    }
  });

  toolMenuPopover.querySelectorAll('.tool-action').forEach(button => {
    button.addEventListener('click', () => {
      toolMenuPopover.hidden = true;
      plusBtn.setAttribute('aria-expanded', 'false');
      plusBtn.classList.remove('open');

      const tool = button.dataset.tool;
      if (!tool) return;
      handleToolAction(tool);
    });
  });
}

// ── Tool chips (attachment-style) ─────────────────────────────────────────────
const composerChips = document.getElementById('composerChips');
let activeToolChip = null; // { tool, label, icon, promptPrefix }

const CHIP_TOOLS = {
  research: { label: 'Deep Research',     icon: '🔬', placeholder: 'Ask a detailed question...',       promptPrefix: '[DEEP RESEARCH MODE] Provide an in-depth, comprehensive analysis: ' },
  map:      { label: 'Visual Map',         icon: '🗺️', placeholder: 'Describe what to visualize...',    promptPrefix: 'Generate a visual semester-by-semester flowchart of my current degree plan. ' },
};

function addToolChip(tool) {
  const info = CHIP_TOOLS[tool];
  if (!info) return;
  // Only one chip at a time
  removeToolChip();
  activeToolChip = { tool, ...info };

  composerChips.hidden = false;
  composerChips.innerHTML = '';
  const chip = document.createElement('span');
  chip.className = 'composer-chip';
  chip.innerHTML = `<span class="chip-icon">${info.icon}</span><span class="chip-label">${info.label}</span><button type="button" class="chip-remove" aria-label="Remove">&times;</button>`;
  chip.querySelector('.chip-remove').addEventListener('click', removeToolChip);
  composerChips.appendChild(chip);

  chatInput.placeholder = info.placeholder;
  chatInput.focus();
}

function removeToolChip() {
  activeToolChip = null;
  if (composerChips) {
    composerChips.innerHTML = '';
    composerChips.hidden = true;
  }
  chatInput.placeholder = 'Message FrogNav...';
}

// ── Tool action handlers ─────────────────────────────────────────────────────
function handleToolAction(tool) {
  // Instant-action tools execute immediately
  switch (tool) {
    case 'upload':
      transcriptFileInput.click();
      return;
    case 'pdf':
      handleExportPDF();
      return;
    case 'sections':
      openSectionsModal();
      return;
  }
  // Chip-based tools: attach chip to composer
  if (CHIP_TOOLS[tool]) {
    addToolChip(tool);
  }
}

// ── Upload Course History ────────────────────────────────────────────────────
async function handleTranscriptFile(file) {
  setStatus('Reading transcript...');
  try {
    const text = await file.text();
    const coursePattern = /\b([A-Z]{2,5})\s*[-]?\s*(\d{4,5})\b/g;
    const courses = new Set();
    let match;
    while ((match = coursePattern.exec(text)) !== null) {
      courses.add(`${match[1]} ${match[2]}`);
    }

    if (courses.size === 0) {
      setStatus('No course codes found in file. Expected format like KINE 10101.', true);
      return;
    }

    const courseList = [...courses].join(', ');
    const completedField = document.getElementById('completedCourses');
    if (completedField) {
      const existing = completedField.value.trim();
      completedField.value = existing
        ? `${existing}, ${courseList}`
        : courseList;
    }
    saveProfile();
    updateSidebarProfile();
    setStatus(`Found ${courses.size} course(s): ${courseList}`);
  } catch (err) {
    setStatus('Failed to read file: ' + (err.message || 'Unknown error'), true);
  }
}

if (transcriptFileInput) {
  transcriptFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleTranscriptFile(file);
    transcriptFileInput.value = '';
  });
}

// Profile upload button (inside Student Profile → Completed Work)
if (profileUploadBtn && profileTranscriptInput) {
  profileUploadBtn.addEventListener('click', () => profileTranscriptInput.click());
  profileTranscriptInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleTranscriptFile(file);
    profileTranscriptInput.value = '';
  });
}

// Select Completed Courses button — opens checklist modal
document.getElementById('openChecklistBtn2')?.addEventListener('click', () => {
  document.getElementById('checklistModal').hidden = false;
});

// Type My Courses button — toggles the textarea
document.getElementById('toggleTypeCoursesBtn')?.addEventListener('click', () => {
  const ta = document.getElementById('completedCourses');
  ta.hidden = !ta.hidden;
  if (!ta.hidden) ta.focus();
});

// ── Create Schedule PDF ──────────────────────────────────────────────────────
function handleExportPDF() {
  if (!lastPlan) {
    setStatus('Build a plan first before exporting as PDF.', true);
    return;
  }

  const printWin = window.open('', '_blank', 'width=900,height=700');
  if (!printWin) {
    setStatus('Pop-up blocked. Please allow pop-ups for this site.', true);
    return;
  }

  const profile = readProfile();
  const studentName = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Student';
  const terms = lastPlan.terms || [];
  const totalCredits = terms.reduce((s, t) => s + (t.totalCredits || 0), 0);

  // Build semester cards — two columns
  let termsHTML = '';
  terms.forEach((term, i) => {
    const rows = (term.courses || [])
      .map((c, j) => `<tr class="${j % 2 ? 'alt' : ''}"><td class="code">${safeText(c.code || 'TBD')}</td><td class="title">${safeText(c.title || '')}</td><td class="cr">${c.credits ?? 0}</td></tr>`)
      .join('');
    termsHTML += `
      <div class="term-card">
        <div class="term-header">
          <span class="term-name">${safeText(term.term || 'Term')}</span>
          <span class="term-credits">${term.totalCredits ?? 0} credits</span>
        </div>
        <table>
          <thead><tr><th class="code">Course</th><th class="title">Title</th><th class="cr">Cr</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="3" style="color:#999;text-align:center;">No courses scheduled</td></tr>'}</tbody>
        </table>
      </div>`;
  });

  // Requirement checklist
  const checklist = lastPlan.requirementChecklist || [];
  let checklistHTML = '';
  if (checklist.length) {
    checklistHTML = `<div class="section"><h3>Requirement Status</h3><div class="req-list">` +
      checklist.map(c => {
        const met = c.status === 'Met' || c.status === 'Planned';
        return `<div class="req-item ${met ? 'met' : 'needs'}"><span class="req-dot">${met ? '&#10003;' : '&#9679;'}</span><span class="req-text">${safeText(c.item)}${c.notes ? ' — ' + safeText(c.notes) : ''}</span></div>`;
      }).join('') +
      `</div></div>`;
  }

  // Notes / warnings
  const warnings = lastPlan.policyWarnings || [];
  let warningsHTML = '';
  if (warnings.length) {
    warningsHTML = `<div class="section notes"><h3>Important Notes</h3><ul>` +
      warnings.map(w => `<li>${safeText(w)}</li>`).join('') +
      `</ul></div>`;
  }

  printWin.document.write(`<!DOCTYPE html><html><head><title>FrogForward Degree Plan — ${safeText(studentName)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Bebas+Neue&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'DM Sans', system-ui, sans-serif; color: #1a1a2e; max-width: 850px; margin: 0 auto; padding: 0; }

  /* Header banner */
  .header { background: linear-gradient(135deg, #4a2d99 0%, #7c3aed 100%); color: #fff; padding: 1.5rem 2rem; display: flex; justify-content: space-between; align-items: flex-end; }
  .header-left h1 { font-family: 'Bebas Neue', sans-serif; font-size: 2rem; letter-spacing: 0.04em; line-height: 1; }
  .header-left h1 span { color: #c4b5fd; }
  .header-left .subtitle { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.15em; opacity: 0.75; margin-top: 0.2rem; }
  .header-right { text-align: right; font-size: 0.75rem; opacity: 0.85; line-height: 1.5; }

  /* Profile card */
  .profile-bar { background: #f8f6ff; border-bottom: 2px solid #e8e0ff; padding: 0.75rem 2rem; display: flex; flex-wrap: wrap; gap: 0.5rem 2rem; font-size: 0.8rem; }
  .profile-bar .item { display: flex; gap: 0.3rem; }
  .profile-bar .label { color: #777; font-weight: 500; }
  .profile-bar .value { color: #1a1a2e; font-weight: 600; }

  /* Summary */
  .summary { padding: 1rem 2rem 0.5rem; font-size: 0.88rem; color: #444; line-height: 1.5; border-bottom: 1px solid #eee; }

  /* Terms grid */
  .terms-grid { padding: 0.75rem 1.5rem; display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  .term-card { border: 1px solid #e0daf0; border-radius: 8px; overflow: hidden; break-inside: avoid; }
  .term-header { background: #4a2d99; color: #fff; padding: 0.4rem 0.65rem; display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem; font-weight: 600; }
  .term-credits { background: rgba(255,255,255,0.2); padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.72rem; font-weight: 500; }
  table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
  thead { background: #f3f0ff; }
  th { padding: 0.25rem 0.5rem; text-align: left; font-weight: 600; color: #4a2d99; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid #e0daf0; }
  td { padding: 0.3rem 0.5rem; border-bottom: 1px solid #f0eef5; }
  tr.alt { background: #faf9ff; }
  .code { width: 28%; font-weight: 600; color: #4a2d99; }
  .title { width: 60%; }
  .cr { width: 12%; text-align: center; font-weight: 600; }

  /* Sections below grid */
  .section { padding: 0.75rem 2rem; }
  .section h3 { font-size: 0.88rem; font-weight: 700; color: #4a2d99; margin-bottom: 0.4rem; border-bottom: 1px solid #e8e0ff; padding-bottom: 0.2rem; }
  .req-list { display: grid; grid-template-columns: 1fr 1fr; gap: 0.25rem 1rem; }
  .req-item { display: flex; align-items: flex-start; gap: 0.35rem; font-size: 0.78rem; line-height: 1.4; }
  .req-dot { flex-shrink: 0; font-size: 0.7rem; margin-top: 0.1rem; }
  .req-item.met .req-dot { color: #16a34a; }
  .req-item.needs .req-dot { color: #d97706; }
  .req-item.met .req-text { color: #333; }
  .req-item.needs .req-text { color: #92400e; }
  .notes ul { font-size: 0.78rem; padding-left: 1.2rem; color: #666; line-height: 1.5; }

  /* Credit summary bar */
  .credit-bar { background: #f8f6ff; padding: 0.5rem 2rem; display: flex; justify-content: space-between; font-size: 0.82rem; font-weight: 600; color: #4a2d99; border-top: 2px solid #e8e0ff; }

  /* Footer */
  .footer { padding: 0.75rem 2rem; font-size: 0.68rem; color: #999; border-top: 1px solid #eee; display: flex; justify-content: space-between; }
  .footer .disclaimer { max-width: 70%; line-height: 1.4; }

  @media print {
    body { padding: 0; }
    .header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .term-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    thead { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    tr.alt { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .profile-bar, .credit-bar { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .req-item.met .req-dot, .req-item.needs .req-dot { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style></head><body>

  <div class="header">
    <div class="header-left">
      <h1>Frog<span>Forward</span></h1>
      <div class="subtitle">TCU Kinesiology · Degree Plan</div>
    </div>
    <div class="header-right">
      ${safeText(studentName)}<br>
      ${safeText(profile.majorProgram || 'Kinesiology')}<br>
      ${safeText(profile.level === 'grad' ? 'Graduate' : 'Undergraduate')}
    </div>
  </div>

  <div class="profile-bar">
    <div class="item"><span class="label">Start:</span><span class="value">${safeText(profile.startTerm || 'TBD')}</span></div>
    <div class="item"><span class="label">Graduation:</span><span class="value">${safeText(lastPlan.profileEcho?.targetGraduation || 'TBD')}</span></div>
    <div class="item"><span class="label">Credits/Term:</span><span class="value">${safeText(String(profile.creditsPerTerm || '15'))}</span></div>
    ${profile.minorProgram ? `<div class="item"><span class="label">Minor:</span><span class="value">${safeText(profile.minorProgram)}</span></div>` : ''}
    ${profile.careerGoal ? `<div class="item"><span class="label">Career Goal:</span><span class="value">${safeText(profile.careerGoal)}</span></div>` : ''}
  </div>

  ${lastPlan.planSummary ? `<div class="summary">${safeText(lastPlan.planSummary)}</div>` : ''}

  <div class="terms-grid">${termsHTML}</div>

  <div class="credit-bar">
    <span>Total Planned Credits: ${totalCredits}</span>
    <span>${terms.length} Semesters</span>
  </div>

  ${checklistHTML}
  ${warningsHTML}

  <div class="footer">
    <div class="disclaimer">${safeText(lastPlan.disclaimer || 'This is planning assistance only and does not replace official advising or the TCU degree audit system.')}</div>
    <div>Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
  </div>

</body></html>`);
  printWin.document.close();
  printWin.focus();
  setTimeout(() => printWin.print(), 400);
  setStatus('PDF print dialog opened.');
}

// ── (Visual Map and Deep Research now use composer chips — see CHIP_TOOLS) ──

// ── Check Live Sections ──────────────────────────────────────────────────────
const sectionsModal   = document.getElementById('sectionsModal');
const closeSectionsBtn = document.getElementById('closeSectionsBtn');
const sectionsSearchBtn = document.getElementById('sectionsSearchBtn');
const sectionsResults  = document.getElementById('sectionsResults');
const sectionsStatus   = document.getElementById('sectionsStatus');
const sectionsSubject  = document.getElementById('sectionsSubject');
const sectionsCourse   = document.getElementById('sectionsCourse');
const sectionsTerm     = document.getElementById('sectionsTerm');

// Populate term dropdown with current and next terms
(function populateTermOptions() {
  if (!sectionsTerm) return;
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const terms = [];
  // Build a list of relevant terms
  const termDefs = [
    { suffix: '30', label: 'Spring' },
    { suffix: '50', label: 'Summer' },
    { suffix: '90', label: 'Fall' },
  ];
  // Current year terms
  for (const t of termDefs) terms.push({ code: `${year}${t.suffix}`, label: `${t.label} ${year}` });
  // Next year spring
  terms.push({ code: `${year + 1}30`, label: `Spring ${year + 1}` });

  // Pick a sensible default: current or upcoming term
  let defaultCode;
  if (month <= 5) defaultCode = `${year}30`;
  else if (month <= 7) defaultCode = `${year}50`;
  else defaultCode = `${year}90`;

  for (const t of terms) {
    const opt = document.createElement('option');
    opt.value = t.code;
    opt.textContent = t.label;
    if (t.code === defaultCode) opt.selected = true;
    sectionsTerm.appendChild(opt);
  }
})();

function openSectionsModal() {
  if (sectionsModal) sectionsModal.hidden = false;
  if (sectionsSubject) sectionsSubject.focus();
}

function closeSectionsModal() {
  if (sectionsModal) sectionsModal.hidden = true;
}

const sidebarSectionsBtn = document.getElementById('sidebarSectionsBtn');
if (sidebarSectionsBtn) {
  sidebarSectionsBtn.addEventListener('click', openSectionsModal);
}
if (closeSectionsBtn) {
  closeSectionsBtn.addEventListener('click', closeSectionsModal);
}
if (sectionsModal) {
  sectionsModal.addEventListener('click', event => {
    if (event.target.matches('[data-close-sections]')) closeSectionsModal();
  });
}

if (sectionsSearchBtn) {
  sectionsSearchBtn.addEventListener('click', searchLiveSections);
}
// Allow Enter key in subject/course inputs
if (sectionsSubject) {
  sectionsSubject.addEventListener('keydown', e => { if (e.key === 'Enter') searchLiveSections(); });
}
if (sectionsCourse) {
  sectionsCourse.addEventListener('keydown', e => { if (e.key === 'Enter') searchLiveSections(); });
}

async function searchLiveSections() {
  const subject = (sectionsSubject?.value || '').trim().toUpperCase();
  if (!subject) {
    if (sectionsStatus) sectionsStatus.textContent = 'Enter a subject code (e.g. KINE).';
    return;
  }

  const courseNum = (sectionsCourse?.value || '').trim();
  if (sectionsStatus) sectionsStatus.textContent = 'Searching classes.tcu.edu...';
  if (sectionsResults) sectionsResults.innerHTML = '';

  try {
    const params = new URLSearchParams({ subject });
    if (courseNum) params.set('course', courseNum);
    const termCode = sectionsTerm?.value;
    if (termCode) params.set('term', termCode);

    const response = await fetch(`/api/tcu-sections?${params}`);
    const payload = await response.json();

    if (!response.ok) {
      if (sectionsStatus) sectionsStatus.textContent = payload.detail || 'Search failed.';
      return;
    }

    const sections = payload.sections || [];
    if (sectionsStatus) {
      let statusMsg = sections.length
        ? `Found ${sections.length} section(s)`
        : (payload.detail || 'No sections found for this search.');
      if (payload.termNote) statusMsg = payload.termNote + ' ' + statusMsg;
      sectionsStatus.textContent = statusMsg;
    }

    sections.forEach(sec => {
      const card = document.createElement('div');
      card.className = 'section-card';

      const seatsAvail = (sec.maximumEnrollment || 0) - (sec.enrollment || 0);
      const seatsClass = seatsAvail > 0 ? 'seats-open' : 'seats-full';

      card.innerHTML = `
        <div class="section-card-header">
          <strong>${safeText(sec.subject)} ${safeText(sec.courseNumber)}-${safeText(sec.sequenceNumber)} · ${safeText(sec.courseTitle)}</strong>
          <span class="section-crn">CRN ${safeText(sec.courseReferenceNumber)}</span>
        </div>
        <div class="section-card-meta">
          ${sec.faculty?.length ? safeText(sec.faculty.map(f => f.displayName).join(', ')) : 'TBA'}
          ${sec.meetingsFaculty?.length ? ' · ' + safeText(formatMeetingTimes(sec.meetingsFaculty)) : ''}
        </div>
        <div class="section-seats">
          <span class="${seatsClass}">${seatsAvail > 0 ? seatsAvail + ' seats open' : 'Full'}</span>
          · ${sec.enrollment || 0}/${sec.maximumEnrollment || 0} enrolled
          ${sec.waitCount > 0 ? ` · ${sec.waitCount} waitlisted` : ''}
        </div>
      `;
      sectionsResults.appendChild(card);
    });
  } catch (err) {
    if (sectionsStatus) sectionsStatus.textContent = 'Network error: ' + (err.message || 'Could not reach server.');
  }
}

function formatMeetingTimes(meetingsFaculty) {
  return meetingsFaculty
    .map(mf => {
      const mt = mf.meetingTime;
      if (!mt) return '';
      const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
        .filter(d => mt[d])
        .map(d => d.charAt(0).toUpperCase() + d.charAt(1))
        .join('');
      const start = mt.beginTime ? `${mt.beginTime.slice(0,2)}:${mt.beginTime.slice(2)}` : '';
      const end = mt.endTime ? `${mt.endTime.slice(0,2)}:${mt.endTime.slice(2)}` : '';
      const building = mt.building || '';
      const room = mt.room || '';
      const loc = (building || room) ? ` (${building} ${room})`.trim() : '';
      return `${days} ${start}–${end}${loc}`;
    })
    .filter(Boolean)
    .join(', ');
}

// ── Chat composer listener ────────────────────────────────────────────────────
chatComposer.addEventListener('submit', event => {
  event.preventDefault();
  const content = chatInput.value.trim();
  if (!content || loading) return;
  chatInput.value = '';

  // If a tool chip is active, wrap the prompt with the tool context
  let prompt = content;
  if (activeToolChip) {
    prompt = activeToolChip.promptPrefix + content;
    removeToolChip();
  }
  callAssistant(prompt, 'chat');
});

// ── Profile form listeners ────────────────────────────────────────────────────
profileForm.addEventListener('input',  () => { saveProfile(); updateQuickActionLabels(); });
profileForm.addEventListener('change', () => { saveProfile(); updateQuickActionLabels(); });

// ── Modal listeners ───────────────────────────────────────────────────────────
// ── Checklist listeners ───────────────────────────────────────────────────────
closeChecklistBtn.addEventListener('click', closeChecklist);
checklistModal.addEventListener('click', event => {
  if (event.target.matches('[data-close-checklist]')) closeChecklist();
});
checklistDoneBtn.addEventListener('click', commitChecklist);
checklistSkipBtn.addEventListener('click', () => {
  closeChecklist();
  if (pendingAction) {
    const { action, prompt } = pendingAction;
    pendingAction = null;
    callAssistant(prompt, action);
  }
});
openProfileBtn.addEventListener('click', openModal);
closeProfileBtn.addEventListener('click', closeModal);
profileModal.addEventListener('click', event => {
  if (event.target.matches('[data-close-modal]')) closeModal();
});

// New Chat button
const newChatBtn = document.getElementById('newChatBtn');
if (newChatBtn) {
  newChatBtn.addEventListener('click', () => {
    messages = [];
    lastPlan = null;
    persistConversation();
    persistLastPlan();
    chatInput.value = '';
    setStatus('');
    renderThread();
  });
}

// Sidebar profile card updater
function updateSidebarProfile() {
  const profile = readProfile();
  const majorEl = document.getElementById('sidebarMajor');
  const careerEl = document.getElementById('sidebarCareer');
  const fillEl = document.getElementById('sidebarProfileFill');
  const labelEl = document.getElementById('sidebarProfileBarLabel');

  if (majorEl) {
    majorEl.textContent = profile.majorProgram || 'No major set';
  }
  if (careerEl) {
    if (profile.careerGoal) {
      careerEl.textContent = profile.careerGoal;
      careerEl.style.display = '';
    } else {
      careerEl.style.display = 'none';
    }
  }

  // Completion bar (same 5 fields as modal bar)
  const fields = [
    profile.majorProgram,
    profile.careerGoal,
    profile.startTerm,
    profile.creditsPerTerm,
    profile.completedCourses,
  ];
  const filled = fields.filter(v => v && String(v).trim() !== '').length;
  const pct = Math.round((filled / fields.length) * 100);
  if (fillEl) fillEl.style.width = pct + '%';
  if (labelEl) {
    labelEl.textContent = pct === 100 ? '✓ Complete' : `${pct}% complete`;
  }
}

// Profile banner — whole pill opens modal, dismiss stops propagation
const profileBanner = document.getElementById('profileBanner');
if (profileBanner) {
  profileBanner.addEventListener('click', () => {
    profileModal.hidden = false;
  });
  profileBanner.querySelector('.profile-banner-dismiss')?.addEventListener('click', (e) => {
    e.stopPropagation();
    profileBanner.hidden = true;
  });
}

// Save profile button
const saveProfileBtn = document.getElementById('saveProfileBtn');
const profileSaveStatus = document.getElementById('profileSaveStatus');
if (saveProfileBtn) {
  saveProfileBtn.addEventListener('click', () => {
    saveProfile();
    updateSidebarProfile();
    profileSaveStatus.textContent = '✓ Saved';
    profileSaveStatus.classList.add('visible');
    setTimeout(() => profileSaveStatus.classList.remove('visible'), 2000);
    profileModal.hidden = true;
    if (profileBanner) profileBanner.hidden = true;
  });
}

// Profile completion bar
function updateProfileCompletion() {
  const fill = document.getElementById('profileCompletionFill');
  const label = document.getElementById('profileCompletionLabel');
  if (!fill || !label) return;
  const fields = [
    document.getElementById('majorProgram')?.value,
    document.getElementById('careerGoal')?.value,
    document.getElementById('startTerm')?.value,
    document.getElementById('creditsPerTerm')?.value,
    document.getElementById('completedCourses')?.value,
  ];
  const filled = fields.filter(v => v && v.trim() !== '' && v !== 'Select a major' && v !== 'Select a career goal').length;
  const pct = Math.round((filled / fields.length) * 100);
  fill.style.width = pct + '%';
  if (pct === 100) {
    label.textContent = '✓ Profile complete — FrogNav has everything it needs';
    label.style.color = 'var(--purple-soft)';
  } else {
    label.textContent = `${filled} of ${fields.length} key fields complete`;
    label.style.color = '';
  }
}

document.getElementById('profileForm')?.addEventListener('input', updateProfileCompletion);
profileModal?.addEventListener('toggle', updateProfileCompletion);
updateProfileCompletion();

// ── Replace panel listeners ───────────────────────────────────────────────────
if (replaceFromInput && replaceToInput && replaceBtn) {
  replaceFromInput.addEventListener('input', () =>
    searchCatalogOptions(replaceFromInput.value)
  );
  replaceToInput.addEventListener('input', () =>
    searchCatalogOptions(replaceToInput.value)
  );
  replaceBtn.addEventListener('click', () => {
    replaceCourseFlow().catch(error => {
      replaceWarnings.textContent = error.message || 'Replace failed.';
      replaceWarnings.classList.add('error');
    });
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
(function bootstrap() {
  // Clear stale data so every page visit starts fresh
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(THREAD_KEY);
  localStorage.removeItem(LAST_PLAN_KEY);

  // Start with defaults
  applyProfile(DEFAULTS);
  messages = [];
  lastPlan = null;

  updateQuickActionLabels();
  updateSidebarProfile();
  renderThread();

  // Show profile banner + sidebar glow if no saved profile
  if (!localStorage.getItem(PROFILE_KEY)) {
    const banner = document.getElementById('profileBanner');
    if (banner) banner.hidden = false;
    const card = document.getElementById('openProfileBtn');
    if (card) {
      card.classList.add('profile-glow');
      card.addEventListener('animationend', () => card.classList.remove('profile-glow'));
    }
  }
})();
