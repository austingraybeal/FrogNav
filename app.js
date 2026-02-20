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
  const major = data.majorProgram || DEFAULT_MAJOR;
  const minor = data.minorProgram || "None";
  const honors = data.honorsCollege || "No";
  const startTerm = data.startTerm || DEFAULT_START_TERM;
  const creditsPerTerm = data.creditsPerTerm || DEFAULT_CREDITS_PER_TERM;
  const constraints = data.constraints || "No additional constraints provided.";
  const completed = parseCourses(data.completedCourses);
  const completedList = completed.length > 0 ? completed.map((course) => `- ${course}`).join("\n") : "- None (assume no AP/transfer credits)";
  const honorsRequirements =
    honors === "Yes"
      ? [
          "- Honors requirements enabled (Roach Honors College):",
          "  - 2 Cultural Visions courses (6 hrs)",
          "  - 3 Honors electives (9 hrs)",
          "  - 3 Honors colloquia (9 hrs)",
          "  - No P/NC for Honors; C- minimum",
        ].join("\n")
      : "- Honors requirements: Not enabled";

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
    honorsRequirements,
    "",
    "Program support constraints:",
    "- Supported majors: Movement Science; Health and Fitness; Physical Education; Physical Education with Strength and Conditioning; Movement Science/MS Athletic Training (3+2).",
    "- Supported minors: Coaching; Fitness; Health; Movement Science; Physical Education; Sport and Exercise Psychology.",
    "",
    "Required output headings in this exact order (verbatim):",
    "PLAN SUMMARY",
    "8-SEMESTER PLAN TABLE (with credit totals)",
    "REQUIREMENT CHECKLIST",
    "POLICY WARNINGS",
    "ADJUSTMENT OPTIONS (2–3 options)",
    "DISCLAIMER",
    "",
    "POLICY WARNINGS must include and enforce these statements:",
    "- No P/NC allowed for KINE core, foundation, emphasis, or associated requirement courses.",
    "- Minimum grade C- required in those courses.",
    "- Movement Science and Health & Fitness require minimum 2.5 GPA in kinesiology core+foundation+emphasis to graduate.",
    "- Physical Education and PE with Strength & Conditioning require 2.75 overall GPA to remain in the major.",
    "- After 54 hours, students must have 2.5 cumulative GPA to enroll in 30000+ KINE/HLTH courses.",
    "- All KINE/HLTH major coursework must be taken at TCU.",
    "- Transfer limits: up to four courses post-matriculation; science associated requirements must be taken at a 4-year institution.",
    "",
    "Missing-information lines:",
    "- Include exactly this line whenever term offerings are not provided: \"Term availability not provided; verify in TCU Class Search.\"",
    "- Include exactly this line whenever prerequisites are not explicitly provided: \"Prerequisite sequencing assumed based on standard progression.\"",
    "- For this student, include both lines because term offerings and explicit prerequisite data were not provided.",
    "",
    "This is planning assistance only and does not replace official advising or the TCU degree audit system.",
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

livePromptFields.forEach((fieldName) => {
  const field = form.elements.namedItem(fieldName);
  if (!field) return;

  ["input", "change"].forEach((eventName) => {
    field.addEventListener(eventName, () => syncDraft());
  });
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
syncDraft({ announce: false });
renderStep();
