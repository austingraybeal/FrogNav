import { planResultSchema, studentProfileSchema } from "@/lib/schemas";
import { PlanResult, StudentProfile } from "@/lib/types";

const PROFILE_KEY = "frognav.studentProfile";
const PLAN_KEY = "frognav.planResult";

function parseJson<T>(raw: string | null, parser: (value: unknown) => T): T | null {
  if (!raw) return null;

  try {
    const value = JSON.parse(raw);
    return parser(value);
  } catch {
    return null;
  }
}

export function saveProfile(profile: StudentProfile) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function loadProfile(): StudentProfile | null {
  if (typeof window === "undefined") return null;
  return parseJson(localStorage.getItem(PROFILE_KEY), (value) => studentProfileSchema.parse(value));
}

export function savePlan(plan: PlanResult) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
}

export function loadPlan(): PlanResult | null {
  if (typeof window === "undefined") return null;
  return parseJson(localStorage.getItem(PLAN_KEY), (value) => planResultSchema.parse(value));
}
