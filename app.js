const PROFILE_KEY = "frognav-profile";
const THREAD_KEY = "frognav-thread";
const LAST_PLAN_KEY = "frognav-last-plan";

const DEFAULTS = {
  majorProgram: "Movement Science",
  minorProgram: "",
  honorsCollege: false,
  startTerm: "Fall 2026",
  targetGraduation: "",
  creditsPerTerm: "15",
  summerOptional: true,
  apTransfer: "None",
  completedCourses: "",
  constraints: "",
};

const QUICK_ACTION_PROMPTS = {
  build: "Build my Movement Science plan",
  add_minor: "Add a minor to my plan",
  honors: "Show me the Honors version",
  compare: "Compare Movement Science and Health & Fitness",
};

const profileForm = document.getElementById("profileForm");
const profileModal = document.getElementById("profileModal");
const openProfileBtn = document.getElementById("openProfileBtn");
const closeProfileBtn = document.getElementById("closeProfileBtn");
const chatThread = document.getElementById("chatThread");
const statusMessage = document.getElementById("statusMessage");
const chatComposer = document.getElementById("chatComposer");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const quickActionButtons = [...document.querySelectorAll(".quick-action")];
const replaceFromInput = document.getElementById("replaceFrom");
const replaceToInput = document.getElementById("replaceTo");
const replaceBtn = document.getElementById("replaceBtn");
const catalogOptions = document.getElementById("catalogOptions");
const replaceWarnings = document.getElementById("replaceWarnings");

let messages = [];
let lastPlan = null;
let loading = false;

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
}

function readProfile() {
  const data = new FormData(profileForm);
  return {
    majorProgram: String(data.get("majorProgram") || "").trim(),
    minorProgram: String(data.get("minorProgram") || "").trim(),
    honorsCollege: Boolean(data.get("honorsCollege")),
    startTerm: String(data.get("startTerm") || "").trim(),
    targetGraduation: String(data.get("targetGraduation") || "").trim(),
    creditsPerTerm: String(data.get("creditsPerTerm") || "").trim(),
    summerOptional: Boolean(data.get("summerOptional")),
    apTransfer: String(data.get("apTransfer") || "").trim(),
    completedCourses: String(data.get("completedCourses") || "").trim(),
    constraints: String(data.get("constraints") || "").trim(),
  };
}

function applyProfile(profile) {
  Object.entries({ ...DEFAULTS, ...(profile || {}) }).forEach(([key, value]) => {
    const field = profileForm.elements.namedItem(key);
    if (!field) return;
    if (field.type === "checkbox") {
      field.checked = Boolean(value);
      return;
    }
    field.value = value ?? "";
  });
}

function profileIsEmpty(profile) {
  return !Object.keys(DEFAULTS).some((key) => {
    if (typeof DEFAULTS[key] === "boolean") return profile[key] !== DEFAULTS[key];
    return String(profile[key] || "").trim() !== "";
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

function setLoading(isLoading) {
  loading = isLoading;
  sendBtn.disabled = isLoading;
  chatInput.disabled = isLoading;
  quickActionButtons.forEach((button) => {
    button.disabled = isLoading;
  });
}

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

function listSection(title, items) {
  const section = document.createElement("section");
  section.className = "plan-section";
  section.innerHTML = `<h4>${title}</h4>`;
  const list = document.createElement("ul");
  const safeItems = Array.isArray(items) && items.length ? items : ["None provided."];
  safeItems.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    list.appendChild(li);
  });
  section.appendChild(list);
  return section;
}

function renderAssistantPlan(container, planJson) {
  const summary = document.createElement("article");
  summary.className = "plan-card";
  const profile = planJson.profileEcho || {};
  summary.innerHTML = `
    <h3>Plan Summary</h3>
    <p>${planJson.planSummary || "No summary provided."}</p>
    <div class="plan-grid">
      <div><strong>Major</strong><p>${profile.major || "Not set"}</p></div>
      <div><strong>Minor</strong><p>${profile.minor || "None"}</p></div>
      <div><strong>Honors</strong><p>${profile.honors ? "Yes" : "No"}</p></div>
      <div><strong>Start Term</strong><p>${profile.startTerm || "Not set"}</p></div>
      <div><strong>Target Graduation</strong><p>${profile.targetGraduation || "Not set"}</p></div>
      <div><strong>Credits / Term</strong><p>${profile.creditsPerTerm ?? "Not set"}</p></div>
    </div>
  `;
  container.appendChild(summary);

  if (Array.isArray(planJson.terms) && planJson.terms.length) {
    const termsSection = document.createElement("section");
    termsSection.className = "plan-section";
    termsSection.innerHTML = "<h4>Terms</h4>";

    const table = document.createElement("table");
    table.className = "plan-table";
    table.innerHTML =
      "<thead><tr><th>Term</th><th>Total Credits</th><th>Courses</th></tr></thead>";

    const body = document.createElement("tbody");
    planJson.terms.forEach((term) => {
      const row = document.createElement("tr");
      const courses = Array.isArray(term.courses) && term.courses.length
        ? term.courses
            .map(
              (course) =>
                `${course.code || "TBD"} - ${course.title || "Untitled"} (${course.credits ?? 0})${
                  course.notes ? ` — ${course.notes}` : ""
                }`
            )
            .join("<br>")
        : "TBD";
      row.innerHTML = `<td>${term.term || "Term"}</td><td>${term.totalCredits ?? 0}</td><td>${courses}</td>`;
      body.appendChild(row);
    });

    table.appendChild(body);
    termsSection.appendChild(table);
    container.appendChild(termsSection);
  }

  const checklistSection = document.createElement("section");
  checklistSection.className = "plan-section";
  checklistSection.innerHTML = "<h4>Requirement Checklist</h4>";
  const checklistList = document.createElement("ul");
  const checklist = Array.isArray(planJson.requirementChecklist) ? planJson.requirementChecklist : [];
  (checklist.length ? checklist : [{ item: "No checklist items.", status: "Needs Review", notes: "" }]).forEach((item) => {
    const li = document.createElement("li");
    li.textContent = `${item.item} — ${item.status}${item.notes ? ` (${item.notes})` : ""}`;
    checklistList.appendChild(li);
  });
  checklistSection.appendChild(checklistList);
  container.appendChild(checklistSection);

  container.appendChild(listSection("Policy Warnings", planJson.policyWarnings));
  container.appendChild(listSection("Adjustment Options", planJson.adjustmentOptions));
  container.appendChild(listSection("Assumptions", planJson.assumptions));
  container.appendChild(listSection("Questions", planJson.questions));

  const disclaimerSection = document.createElement("section");
  disclaimerSection.className = "plan-section";
  disclaimerSection.innerHTML = `<h4>Disclaimer</h4><p>${planJson.disclaimer || "No disclaimer provided."}</p>`;
  container.appendChild(disclaimerSection);
}

function renderThread() {
  chatThread.innerHTML = "";

  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "empty-thread";
    empty.textContent = "Start by choosing a quick action or sending a message.";
    chatThread.appendChild(empty);
    return;
  }

  messages.forEach((message) => {
    const node = document.createElement("article");
    node.className = `msg ${message.role}`;

    if (message.role === "assistant" && message.planJson) {
      renderAssistantPlan(node, message.planJson);
    } else {
      const text = document.createElement("p");
      text.textContent = message.content;
      node.appendChild(text);
    }

    chatThread.appendChild(node);
  });

  chatThread.scrollTop = chatThread.scrollHeight;
}

async function callAssistant(userContent, action = "chat") {
  messages.push({ role: "user", content: userContent });
  renderThread();
  persistConversation();

  setLoading(true);
  setStatus("FrogNav is thinking...");

  try {
    const response = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: readProfile(),
        action,
        lastPlan,
        message: userContent,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const backendMessage = payload.error || "Unknown backend error.";
      throw new Error(`Request failed (${response.status}): ${backendMessage}`);
    }

    lastPlan = payload;
    persistLastPlan();

    messages.push({
      role: "assistant",
      content: payload.planSummary || "Plan generated.",
      planJson: payload,
    });

    setStatus("Ready.");
  } catch (error) {
    messages.push({
      role: "assistant",
      content: error.message || "Request failed.",
    });
    setStatus(error.message || "Request failed.", true);
  } finally {
    persistConversation();
    setLoading(false);
    renderThread();
  }
}


async function searchCatalogOptions(query) {
  if (!query || query.trim().length < 2) return;
  const response = await fetch(`/api/catalog/search?q=${encodeURIComponent(query)}&limit=8`);
  const payload = await response.json().catch(() => ({ results: [] }));
  const results = Array.isArray(payload.results) ? payload.results : [];
  catalogOptions.innerHTML = '';
  results.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.code;
    option.label = `${item.code} — ${item.description || ''}`;
    catalogOptions.appendChild(option);
  });
}

async function replaceCourseFlow() {
  const fromCode = replaceFromInput.value.trim().toUpperCase();
  const toCode = replaceToInput.value.trim().toUpperCase();
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
  const response = await fetch('/api/plan/replace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planJson: lastPlan, fromCode, toCode, profile: readProfile() }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    replaceWarnings.textContent = payload.error || 'Replace failed.';
    replaceWarnings.classList.add('error');
    return;
  }

  lastPlan = payload.planJson;
  persistLastPlan();
  messages.push({ role: 'assistant', content: `Replaced ${fromCode} with ${toCode}.`, planJson: lastPlan });
  persistConversation();
  renderThread();

  const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
  replaceWarnings.textContent = warnings.length ? warnings.join(' ') : 'Course replacement applied.';
  replaceWarnings.classList.toggle('error', warnings.length > 0);
}

function openModal() {
  profileModal.hidden = false;
}

function closeModal() {
  profileModal.hidden = true;
}

quickActionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.action;
    if (!action) return;

    if (action === "build") {
      ensureBuildDefaults();
    }

    if (action === "add_minor" && !readProfile().minorProgram) {
      setStatus("Select a minor in Student Profile before using Add a minor to my plan.", true);
      openModal();
      return;
    }

    callAssistant(QUICK_ACTION_PROMPTS[action], action);
  });
});

chatComposer.addEventListener("submit", (event) => {
  event.preventDefault();
  const content = chatInput.value.trim();
  if (!content || loading) return;
  chatInput.value = "";
  callAssistant(content, "chat");
});

profileForm.addEventListener("input", saveProfile);
profileForm.addEventListener("change", saveProfile);
openProfileBtn.addEventListener("click", openModal);
closeProfileBtn.addEventListener("click", closeModal);
profileModal.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-modal]")) closeModal();
});

if (replaceFromInput && replaceToInput && replaceBtn) {
  replaceFromInput.addEventListener('input', () => searchCatalogOptions(replaceFromInput.value));
  replaceToInput.addEventListener('input', () => searchCatalogOptions(replaceToInput.value));
  replaceBtn.addEventListener('click', () => {
    replaceCourseFlow().catch((error) => {
      replaceWarnings.textContent = error.message || 'Replace failed.';
      replaceWarnings.classList.add('error');
    });
  });
}

(function bootstrap() {
  const savedProfile = localStorage.getItem(PROFILE_KEY);
  if (savedProfile) {
    try {
      applyProfile(JSON.parse(savedProfile));
    } catch {
      applyProfile(DEFAULTS);
    }
  } else {
    applyProfile(DEFAULTS);
  }

  const savedMessages = localStorage.getItem(THREAD_KEY);
  if (savedMessages) {
    try {
      messages = JSON.parse(savedMessages);
    } catch {
      messages = [];
    }
  }

  const savedPlan = localStorage.getItem(LAST_PLAN_KEY);
  if (savedPlan) {
    try {
      lastPlan = JSON.parse(savedPlan);
    } catch {
      lastPlan = null;
    }
  }

  renderThread();
})();
