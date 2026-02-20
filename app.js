const STORAGE_KEY = "frognav-agent-shell-intake";
const TOTAL_STEPS = 3;
const DEFAULT_MAJOR = "Movement Science";
const DEFAULT_START_TERM = "Fall 2026";
const DEFAULT_CREDITS_PER_TERM = "15";

const form = document.getElementById("intake-form");
const steps = [...document.querySelectorAll(".wizard-step")];
const stepIndicator = document.getElementById("step-indicator");
const nextBtn = document.getElementById("nextBtn");
const backBtn = document.getElementById("backBtn");
const statusMessage = document.getElementById("statusMessage");
const promptBox = document.getElementById("generatedPrompt");
const copyPromptBtn = document.getElementById("copyPromptBtn");
const copyJsonBtn = document.getElementById("copyJsonBtn");
const generatePlanBtn = document.getElementById("generatePlanBtn");
const agentOutputStatus = document.getElementById("agentOutputStatus");
const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const sendChatBtn = document.getElementById("sendChatBtn");
const clearConversationBtn = document.getElementById("clearConversationBtn");
const livePromptFields = [
  "majorProgram",
  "minorProgram",
  "honorsCollege",
  "startTerm",
  "targetGraduation",
  "creditsPerTerm",
  "completedCourses",
  "constraints",
];

let currentStep = 0;
let conversation = [];
let loading = false;

function getFormData() {
  const data = new FormData(form);
  return {
    majorProgram: (data.get("majorProgram") || "").toString().trim(),
    minorProgram: (data.get("minorProgram") || "").toString().trim(),
    honorsCollege: (data.get("honorsCollege") || "").toString().trim(),
    startTerm: (data.get("startTerm") || "").toString().trim(),
    targetGraduation: (data.get("targetGraduation") || "").toString().trim(),
    creditsPerTerm: (data.get("creditsPerTerm") || "").toString().trim(),
    completedCourses: (data.get("completedCourses") || "").toString().trim(),
    constraints: (data.get("constraints") || "").toString().trim(),
  };
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
}

function setAgentOutputStatus(message, isError = false) {
  agentOutputStatus.textContent = message;
  agentOutputStatus.classList.toggle("error", isError);
}

function saveToLocalStorage() {
  const payload = getFormData();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function hydrateFromLocalStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    Object.entries(parsed).forEach(([key, value]) => {
      const field = form.elements.namedItem(key);
      if (!field || typeof value !== "string") return;

      if (typeof field.length === "number" && !field.tagName) {
        const match = [...field].find((option) => option.value === value);
        if (match) match.checked = true;
        return;
      }

      field.value = value;
    });
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function parseCourses(text) {
  if (!text) return [];
  return text
    .split(/[\n,]/)
    .map((course) => course.trim())
    .filter(Boolean);
}

function buildPrompt(data) {
  const major = data.majorProgram || DEFAULT_MAJOR;
  const minor = data.minorProgram || "None";
  const honors = data.honorsCollege || "No";
  const startTerm = data.startTerm || DEFAULT_START_TERM;
  const creditsPerTerm = data.creditsPerTerm || DEFAULT_CREDITS_PER_TERM;
  const constraints = data.constraints || "No additional constraints provided.";
  const completed = parseCourses(data.completedCourses);
  const completedList = completed.length > 0 ? completed.map((course) => `- ${course}`).join("\n") : "- None (assume no AP/transfer credits)";

  return [
    "You are FrogNav GPT, a TCU kinesiology planning assistant.",
    "Generate an advising-style 8-semester plan using only provided requirements and explicit assumptions.",
    "Do not hallucinate course requirements.",
    "",
    "Student intake:",
    `- Major / Program: ${major}`,
    `- Minor: ${minor}`,
    `- Roach Honors College: ${honors}`,
    `- Start term: ${startTerm}`,
    `- Target graduation: ${data.targetGraduation || "Not provided"}`,
    `- Planned credits per Fall/Spring term: ${creditsPerTerm}`,
    "- Summer term: Optional",
    "- AP/transfer credits: None (default unless user provides otherwise)",
    "- Course offering data: Not available",
    "- Completed courses:",
    completedList,
    "- Constraints / preferences:",
    constraints,
    "",
    "Required output structure should support:",
    "- PLAN SUMMARY",
    "- 8-SEMESTER PLAN TABLE (with credit totals)",
    "- REQUIREMENT CHECKLIST",
    "- POLICY WARNINGS",
    "- ADJUSTMENT OPTIONS (2–3 options)",
    "- DISCLAIMER",
  ].join("\n");
}

function validateStep(stepIdx) {
  const fields = [...steps[stepIdx].querySelectorAll("input[required], textarea[required], select[required]")];
  for (const field of fields) {
    if (!field.value.trim()) {
      field.reportValidity();
      return false;
    }
  }
  return true;
}

function renderStep() {
  steps.forEach((step, idx) => {
    step.hidden = idx !== currentStep;
  });

  stepIndicator.textContent = `Step ${currentStep + 1} of ${TOTAL_STEPS}`;
  backBtn.disabled = currentStep === 0;
  nextBtn.textContent = currentStep === TOTAL_STEPS - 1 ? "Generate Prompt" : "Next";
}

function refreshGeneratedPrompt() {
  const data = getFormData();
  promptBox.value = buildPrompt(data);
}

function syncDraft({ announce = true } = {}) {
  saveToLocalStorage();
  refreshGeneratedPrompt();

  if (announce) {
    setStatus("Draft auto-saved locally.");
  }
}

function copyText(value, successMessage) {
  navigator.clipboard
    .writeText(value)
    .then(() => setStatus(successMessage))
    .catch(() => setStatus("Clipboard access failed. You can still select and copy manually.", true));
}

function formatPlanAsText(plan) {
  const termsText = (plan.terms || [])
    .map((term) => {
      const courseLines = (term.courses || []).map((course) => `  - ${course}`).join("\n");
      return `${term.term} (${term.credits} credits)\n${courseLines}`;
    })
    .join("\n\n");

  const checklistText = (plan.requirementChecklist || [])
    .map((item) => `- ${item.item}: ${item.status}${item.notes ? ` (${item.notes})` : ""}`)
    .join("\n");

  const warningsText = (plan.warnings || []).map((w) => `- ${w}`).join("\n");
  const optionsText = (plan.adjustmentOptions || []).map((o) => `- ${o}`).join("\n");

  return [
    "PLAN SUMMARY",
    plan.planSummary || "",
    "",
    "8-SEMESTER PLAN TABLE (with credit totals)",
    termsText,
    "",
    "REQUIREMENT CHECKLIST",
    checklistText,
    "",
    "POLICY WARNINGS",
    warningsText,
    "",
    "ADJUSTMENT OPTIONS (2–3 options)",
    optionsText,
    "",
    "DISCLAIMER",
    plan.disclaimer || "",
  ].join("\n");
}

function createCopyButton(plan) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-response-btn secondary";
  button.textContent = "Copy response";
  button.addEventListener("click", () => {
    navigator.clipboard
      .writeText(formatPlanAsText(plan))
      .then(() => setAgentOutputStatus("Response copied."))
      .catch(() => setAgentOutputStatus("Clipboard unavailable. Select and copy manually.", true));
  });
  return button;
}

function renderList(items, className) {
  const list = document.createElement("ul");
  list.className = className;

  (items || []).forEach((itemText) => {
    const item = document.createElement("li");
    item.textContent = itemText;
    list.appendChild(item);
  });

  return list;
}

function renderTermsTable(terms) {
  const wrapper = document.createElement("div");
  wrapper.className = "plan-table-wrap";

  const table = document.createElement("table");
  table.className = "plan-table";

  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>Term</th><th>Courses</th><th>Credits</th></tr>";
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  let totalCredits = 0;

  (terms || []).forEach((term) => {
    const row = document.createElement("tr");

    const termCell = document.createElement("td");
    termCell.textContent = term.term || "Unspecified term";

    const coursesCell = document.createElement("td");
    const courseList = renderList(term.courses || [], "table-course-list");
    coursesCell.appendChild(courseList);

    const creditsCell = document.createElement("td");
    const credits = Number(term.credits) || 0;
    totalCredits += credits;
    creditsCell.textContent = String(credits);

    row.appendChild(termCell);
    row.appendChild(coursesCell);
    row.appendChild(creditsCell);
    tbody.appendChild(row);
  });

  const totalRow = document.createElement("tr");
  totalRow.className = "total-row";
  totalRow.innerHTML = `<td colspan="2">Total Credits</td><td>${totalCredits}</td>`;
  tbody.appendChild(totalRow);

  table.appendChild(tbody);
  wrapper.appendChild(table);
  return wrapper;
}

function renderAssistantMessage(item, plan) {
  const cards = document.createElement("div");
  cards.className = "assistant-cards";

  const summaryCard = document.createElement("section");
  summaryCard.className = "assistant-section";
  summaryCard.innerHTML = `<h4>PLAN SUMMARY</h4><p class="assistant-copy">${plan.planSummary || "No summary provided."}</p>`;

  const tableCard = document.createElement("section");
  tableCard.className = "assistant-section";
  const tableHeading = document.createElement("h4");
  tableHeading.textContent = "8-SEMESTER PLAN TABLE (with credit totals)";
  tableCard.appendChild(tableHeading);
  tableCard.appendChild(renderTermsTable(plan.terms || []));

  const checklistCard = document.createElement("section");
  checklistCard.className = "assistant-section";
  checklistCard.innerHTML = "<h4>REQUIREMENT CHECKLIST</h4>";
  const checklistTable = document.createElement("table");
  checklistTable.className = "checklist-table";
  checklistTable.innerHTML = "<thead><tr><th>Requirement</th><th>Status</th><th>Notes</th></tr></thead>";
  const checklistBody = document.createElement("tbody");
  (plan.requirementChecklist || []).forEach((entry) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${entry.item || ""}</td><td>${entry.status || ""}</td><td>${entry.notes || ""}</td>`;
    checklistBody.appendChild(row);
  });
  checklistTable.appendChild(checklistBody);
  checklistCard.appendChild(checklistTable);

  const warningsCard = document.createElement("section");
  warningsCard.className = "assistant-section";
  warningsCard.innerHTML = "<h4>POLICY WARNINGS</h4>";
  warningsCard.appendChild(renderList(plan.warnings || [], "assistant-list"));

  const optionsCard = document.createElement("section");
  optionsCard.className = "assistant-section";
  optionsCard.innerHTML = "<h4>ADJUSTMENT OPTIONS (2–3 options)</h4>";
  optionsCard.appendChild(renderList(plan.adjustmentOptions || [], "assistant-list"));

  const disclaimerCard = document.createElement("section");
  disclaimerCard.className = "assistant-section";
  disclaimerCard.innerHTML = `<h4>DISCLAIMER</h4><p class="assistant-copy">${plan.disclaimer || ""}</p>`;

  cards.append(summaryCard, tableCard, checklistCard, warningsCard, optionsCard, disclaimerCard);
  item.appendChild(cards);
}

function renderConversation() {
  chatMessages.innerHTML = "";

  if (!conversation.length) {
    const empty = document.createElement("p");
    empty.className = "chat-empty";
    empty.textContent = 'No messages yet. Click "Generate Plan" to start.';
    chatMessages.appendChild(empty);
    return;
  }

  conversation.forEach((message) => {
    const item = document.createElement("article");
    item.className = `chat-message ${message.role}`;

    const header = document.createElement("div");
    header.className = "chat-message-header";

    const label = document.createElement("strong");
    label.textContent = message.role === "assistant" ? "FrogNav" : "You";
    header.appendChild(label);

    if (message.role === "assistant") {
      header.appendChild(createCopyButton(message.plan));
    }

    item.appendChild(header);

    if (message.role === "assistant") {
      renderAssistantMessage(item, message.plan);
    } else {
      const body = document.createElement("p");
      body.className = "user-message-body";
      body.textContent = message.content;
      item.appendChild(body);
    }

    chatMessages.appendChild(item);
  });

  if (loading) {
    const loadingItem = document.createElement("article");
    loadingItem.className = "chat-message assistant loading";
    loadingItem.textContent = "FrogNav is thinking...";
    chatMessages.appendChild(loadingItem);
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setLoadingState(isLoading) {
  loading = isLoading;
  generatePlanBtn.disabled = isLoading;
  sendChatBtn.disabled = isLoading;
  chatInput.disabled = isLoading;
  renderConversation();
}

function normalizePlan(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (!Array.isArray(payload.terms) || !Array.isArray(payload.warnings) || !Array.isArray(payload.adjustmentOptions)) return null;

  return {
    planSummary: String(payload.planSummary || ""),
    terms: payload.terms,
    requirementChecklist: Array.isArray(payload.requirementChecklist) ? payload.requirementChecklist : [],
    warnings: payload.warnings,
    adjustmentOptions: payload.adjustmentOptions,
    disclaimer: String(payload.disclaimer || ""),
  };
}

async function requestAssistantReply(messages) {
  const response = await fetch("/api/plan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intake: getFormData(),
      messages,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "FrogNav couldn't generate a response right now.");
  }

  const plan = normalizePlan(payload);
  if (!plan) {
    throw new Error("FrogNav returned an invalid structured response.");
  }

  return plan;
}

async function generatePlan() {
  refreshGeneratedPrompt();
  const seedMessage = {
    role: "user",
    content: `Please generate my full semester plan using this intake and instructions.\n\n${promptBox.value}`,
  };

  const outboundMessages = [seedMessage];
  conversation = [seedMessage];
  setLoadingState(true);
  setAgentOutputStatus("Generating plan...");

  try {
    const plan = await requestAssistantReply(outboundMessages);
    conversation.push({ role: "assistant", plan });
    setAgentOutputStatus("Plan generated. You can now send follow-up questions.");
  } catch (error) {
    setAgentOutputStatus(error.message || "Unable to generate a plan right now.", true);
  } finally {
    setLoadingState(false);
  }
}

function getConversationForApi(extraUserMessage = null) {
  const messages = [];
  conversation.forEach((message) => {
    if (message.role === "user") {
      messages.push({ role: "user", content: message.content });
      return;
    }

    if (message.role === "assistant" && message.plan) {
      messages.push({ role: "assistant", content: formatPlanAsText(message.plan) });
    }
  });

  if (extraUserMessage) {
    messages.push({ role: "user", content: extraUserMessage });
  }

  return messages;
}

async function sendChatMessage(event) {
  event.preventDefault();

  const content = chatInput.value.trim();
  if (!content) return;

  if (!conversation.length) {
    setAgentOutputStatus('Start with "Generate Plan" first so FrogNav has your baseline plan.', true);
    return;
  }

  conversation.push({ role: "user", content });
  chatInput.value = "";
  setLoadingState(true);
  setAgentOutputStatus("Sending message...");

  try {
    const plan = await requestAssistantReply(getConversationForApi(content));
    conversation.push({ role: "assistant", plan });
    setAgentOutputStatus("FrogNav replied.");
  } catch (error) {
    setAgentOutputStatus(error.message || "Unable to send message right now.", true);
  } finally {
    setLoadingState(false);
  }
}

function clearConversation() {
  conversation = [];
  renderConversation();
  setAgentOutputStatus("Conversation cleared.");
}

nextBtn.addEventListener("click", () => {
  if (!validateStep(currentStep)) return;

  if (currentStep < TOTAL_STEPS - 1) {
    currentStep += 1;
    renderStep();
    return;
  }

  refreshGeneratedPrompt();
  setStatus("Prompt generated. Copy it, open FrogNav GPT, or generate a plan here.");
});

backBtn.addEventListener("click", () => {
  if (currentStep === 0) return;
  currentStep -= 1;
  renderStep();
});

livePromptFields.forEach((fieldName) => {
  const field = form.elements.namedItem(fieldName);
  if (!field) return;

  const register = (element) => {
    ["input", "change"].forEach((eventName) => {
      element.addEventListener(eventName, () => syncDraft());
    });
  };

  if (typeof field.length === "number" && !field.tagName) {
    [...field].forEach(register);
    return;
  }

  register(field);
});

copyPromptBtn.addEventListener("click", () => {
  if (!promptBox.value.trim()) refreshGeneratedPrompt();
  copyText(promptBox.value, "Prompt copied to clipboard.");
});

copyJsonBtn.addEventListener("click", () => {
  const data = getFormData();
  copyText(JSON.stringify(data, null, 2), "Intake JSON copied to clipboard.");
});

generatePlanBtn.addEventListener("click", generatePlan);
chatForm.addEventListener("submit", sendChatMessage);
clearConversationBtn.addEventListener("click", clearConversation);

hydrateFromLocalStorage();
syncDraft({ announce: false });
renderStep();
renderConversation();
