'use strict';

// ── Storage keys ──────────────────────────────────────────────────────────────
const PROFILE_KEY   = 'frognav-profile';
const THREAD_KEY    = 'frognav-thread';
const LAST_PLAN_KEY = 'frognav-last-plan';

// ── Profile defaults ──────────────────────────────────────────────────────────
const DEFAULTS = {
  level:             'undergrad',
  majorProgram:      'Movement Science',
  minorProgram:      '',
  honorsCollege:     false,
  startTerm:         'Fall 2026',
  targetGraduation:  '',
  creditsPerTerm:    '15',
  summerOptional:    true,
  apTransfer:        'None',
  completedCourses:  '',
  constraints:       '',
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
const sendBtn           = document.getElementById('sendBtn');
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
// ─────────────────────────────────────────────────────────────────────────────

// ── App state ─────────────────────────────────────────────────────────────────
let messages = [];
let lastPlan = null;
let loading  = false;
let pendingAction = null; // stores { action, prompt } while checklist is open

// ── Status bar ────────────────────────────────────────────────────────────────
function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle('error', isError);
}

// ── Profile helpers ───────────────────────────────────────────────────────────
function readProfile() {
  const data = new FormData(profileForm);
  return {
    level:            String(data.get('level') || 'undergrad').trim().toLowerCase() === 'grad' ? 'grad' : 'undergrad',
    majorProgram:     String(data.get('majorProgram')    || '').trim(),
    minorProgram:     String(data.get('minorProgram')    || '').trim(),
    honorsCollege:    Boolean(data.get('honorsCollege')),
    startTerm:        String(data.get('startTerm')        || '').trim(),
    targetGraduation: String(data.get('targetGraduation') || '').trim(),
    creditsPerTerm:   String(data.get('creditsPerTerm')   || '').trim(),
    summerOptional:   Boolean(data.get('summerOptional')),
    apTransfer:       String(data.get('apTransfer')       || '').trim(),
    completedCourses: String(data.get('completedCourses') || '').trim(),
    constraints:      String(data.get('constraints')      || '').trim(),
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
    termsSection.className = 'plan-section';
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

  // Requirement checklist
  const checklistSection   = document.createElement('section');
  checklistSection.className = 'plan-section';
  const checklistHeading   = document.createElement('h4');
  checklistHeading.textContent = 'Requirement Checklist';
  checklistSection.appendChild(checklistHeading);

  const checklistList = document.createElement('ul');
  const checklist     = Array.isArray(planJson.requirementChecklist)
    ? planJson.requirementChecklist
    : [];
  const checklistItems = checklist.length
    ? checklist
    : [{ item: 'No checklist items.', status: 'Needs Review', notes: '' }];

  checklistItems.forEach(item => {
    const li = document.createElement('li');
    li.textContent =
      `${item.item} — ${item.status}${item.notes ? ` (${item.notes})` : ''}`;
    checklistList.appendChild(li);
  });
  checklistSection.appendChild(checklistList);
  container.appendChild(checklistSection);

  container.appendChild(listSection('Policy Warnings',    planJson.policyWarnings));
  container.appendChild(listSection('Adjustment Options', planJson.adjustmentOptions));
  container.appendChild(listSection('Assumptions',        planJson.assumptions));
  container.appendChild(listSection('Questions',          planJson.questions));

  const disclaimerSection   = document.createElement('section');
  disclaimerSection.className = 'plan-section';
  const disclaimerHeading   = document.createElement('h4');
  disclaimerHeading.textContent = 'Disclaimer';
  const disclaimerText      = document.createElement('p');
  disclaimerText.textContent = planJson.disclaimer || 'No disclaimer provided.';
  disclaimerSection.appendChild(disclaimerHeading);
  disclaimerSection.appendChild(disclaimerText);
  container.appendChild(disclaimerSection);
}

// ── Thread renderer ───────────────────────────────────────────────────────────
function renderThread() {
  chatThread.innerHTML = '';

  if (!messages.length) {
    const empty   = document.createElement('p');
    empty.className = 'empty-thread';
    empty.textContent = 'Start by choosing a quick action or sending a message.';
    chatThread.appendChild(empty);
    return;
  }

  messages.forEach(message => {
    const node    = document.createElement('article');
    node.className = `msg ${message.role}`;

    if (message.role === 'assistant' && message.planJson) {
      renderAssistantPlan(node, message.planJson);
    } else {
      const text  = document.createElement('p');
      text.textContent = message.content;
      node.appendChild(text);
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

    lastPlan = payload;
    persistLastPlan();

    messages.push({
      role:     'assistant',
      content:  payload.planSummary || 'Plan generated.',
      planJson: payload,
    });

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

    // Show checklist interstitial if completedCourses is empty
    if (!profile.completedCourses && profile.level === 'undergrad') {
      openChecklistForAction(action, prompt);
      return;
    }

    callAssistant(prompt, action);
  });
});

// ── Chat composer listener ────────────────────────────────────────────────────
chatComposer.addEventListener('submit', event => {
  event.preventDefault();
  const content = chatInput.value.trim();
  if (!content || loading) return;
  chatInput.value = '';
  callAssistant(content, 'chat');
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
  // Restore saved profile or apply defaults
  const savedProfile = localStorage.getItem(PROFILE_KEY);
  if (savedProfile) {
    try   { applyProfile(JSON.parse(savedProfile)); }
    catch { applyProfile(DEFAULTS); }
  } else {
    applyProfile(DEFAULTS);
  }

  // Restore conversation history
  const savedMessages = localStorage.getItem(THREAD_KEY);
  if (savedMessages) {
    try   { messages = JSON.parse(savedMessages); }
    catch { messages = []; }
  }

  // Restore last plan
  const savedPlan = localStorage.getItem(LAST_PLAN_KEY);
  if (savedPlan) {
    try   { lastPlan = JSON.parse(savedPlan); }
    catch { lastPlan = null; }
  }

  updateQuickActionLabels();
  renderThread();
})();
