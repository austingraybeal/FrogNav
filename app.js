const STORAGE_KEY = "frognav-agent-shell-intake";
const TOTAL_STEPS = 3;

const form = document.getElementById("intake-form");
const steps = [...document.querySelectorAll(".wizard-step")];
const stepIndicator = document.getElementById("step-indicator");
const nextBtn = document.getElementById("nextBtn");
const backBtn = document.getElementById("backBtn");
const statusMessage = document.getElementById("statusMessage");
const promptBox = document.getElementById("generatedPrompt");
const copyPromptBtn = document.getElementById("copyPromptBtn");
const copyJsonBtn = document.getElementById("copyJsonBtn");

let currentStep = 0;

function getFormData() {
  const data = new FormData(form);
  return {
    majorProgram: (data.get("majorProgram") || "").toString().trim(),
    startTerm: (data.get("startTerm") || "").toString().trim(),
    targetGraduation: (data.get("targetGraduation") || "").toString().trim(),
    creditsPerTerm: (data.get("creditsPerTerm") || "").toString().trim(),
    completedCourses: (data.get("completedCourses") || "").toString().trim(),
    constraints: (data.get("constraints") || "").toString().trim(),
  };
}

function setStatus(message) {
  statusMessage.textContent = message;
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
      if (field && typeof value === "string") {
        field.value = value;
      }
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
  const completed = parseCourses(data.completedCourses);
  const constraints = data.constraints || "No additional constraints provided.";
  const completedList =
    completed.length > 0
      ? completed.map((course) => `- ${course}`).join("\n")
      : "- None yet";

  return [
    "You are FrogNav GPT, an academic planning assistant.",
    "Create a term-by-term degree plan and advising strategy for the student profile below.",
    "",
    "Student intake:",
    `- Major / Program: ${data.majorProgram || "Not provided"}`,
    `- Start term: ${data.startTerm || "Not provided"}`,
    `- Target graduation: ${data.targetGraduation || "Not provided"}`,
    `- Desired credits per term: ${data.creditsPerTerm || "Not provided"}`,
    "- Completed courses:",
    completedList,
    "- Constraints / preferences:",
    constraints,
    "",
    "Output requirements:",
    "1) Provide a proposed semester-by-semester plan from start through graduation.",
    "2) Flag risk areas (prerequisite chains, overload terms, missing core requirements).",
    "3) Offer at least two alternate pathways if constraints are tight.",
    "4) Recommend advisor questions and checkpoints for each academic year.",
    "5) Include a compact JSON summary at the end with terms, credits, and major milestones.",
  ].join("\n");
}

function validateStep(stepIdx) {
  const fields = [...steps[stepIdx].querySelectorAll("input[required], textarea[required]")];
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

function copyText(value, successMessage) {
  navigator.clipboard
    .writeText(value)
    .then(() => setStatus(successMessage))
    .catch(() => setStatus("Clipboard access failed. You can still select and copy manually."));
}

nextBtn.addEventListener("click", () => {
  if (!validateStep(currentStep)) return;

  if (currentStep < TOTAL_STEPS - 1) {
    currentStep += 1;
    renderStep();
    return;
  }

  refreshGeneratedPrompt();
  setStatus("Prompt generated. Copy it or open FrogNav GPT.");
});

backBtn.addEventListener("click", () => {
  if (currentStep === 0) return;
  currentStep -= 1;
  renderStep();
});

form.addEventListener("input", () => {
  saveToLocalStorage();
  refreshGeneratedPrompt();
  setStatus("Draft auto-saved locally.");
});

copyPromptBtn.addEventListener("click", () => {
  if (!promptBox.value.trim()) refreshGeneratedPrompt();
  copyText(promptBox.value, "Prompt copied to clipboard.");
});

copyJsonBtn.addEventListener("click", () => {
  const data = getFormData();
  copyText(JSON.stringify(data, null, 2), "Intake JSON copied to clipboard.");
});

hydrateFromLocalStorage();
refreshGeneratedPrompt();
renderStep();
