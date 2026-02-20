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
  minor: "Add a minor to my plan",
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
    return;
  }
  localStorage.removeItem(LAST_PLAN_KEY);
}

function renderAssistantPlan(container, planJson) {
  const summary = document.createElement("div");
  summary.className = "plan-grid";

  const cards = [
    ["Major", planJson.major || "Not set"],
    ["Start", planJson.startTerm || "Not set"],
    ["Target Graduation", planJson.targetGraduation || "Not set"],
    ["Credits / Term", planJson.creditsPerTerm || "Not set"],
  ];

  cards.forEach(([label, value]) => {
    const card = document.createElement("article");
    card.className = "plan-card";
    card.innerHTML = `<strong>${label}</strong><p>${value}</p>`;
    summary.appendChild(card);
  });
  container.appendChild(summary);

  if (Array.isArray(planJson.terms) && planJson.terms.length) {
    const table = document.createElement("table");
    table.className = "plan-table";
    table.innerHTML = "<thead><tr><th>Term</th><th>Courses</th><th>Credits</th></tr></thead>";
    const body = document.createElement("tbody");

    planJson.terms.forEach((term) => {
      const row = document.createElement("tr");
      row.innerHTML = `<td>${term.name || "Term"}</td><td>${(term.courses || []).join("<br>") || "TBD"}</td><td>${term.credits || ""}</td>`;
      body.appendChild(row);
    });

    table.appendChild(body);
    container.appendChild(table);
  }
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
      const text = document.createElement("p");
      text.textContent = message.content;
      node.appendChild(text);
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
        messages,
        lastPlan,
        action,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Unable to complete request right now.");
    }

    const assistantMessage = {
      role: "assistant",
      content: payload.reply || "I could not generate a response.",
    };

    if (payload.planJson && typeof payload.planJson === "object") {
      assistantMessage.planJson = payload.planJson;
      lastPlan = payload.planJson;
      persistLastPlan();
    }

    messages.push(assistantMessage);
    setStatus("Ready.");
  } catch (error) {
    messages.push({
      role: "assistant",
      content: "Sorry—I'm having trouble right now. Please try again in a moment.",
    });
    setStatus(error.message || "Request failed.", true);
  } finally {
    persistConversation();
    setLoading(false);
    renderThread();
  }
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
