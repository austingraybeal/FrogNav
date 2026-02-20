import { NextResponse } from "next/server";
import { POLICY_WARNINGS, TERM_AVAILABILITY_WARNING } from "@/lib/constants";
import { studentProfileSchema } from "@/lib/schemas";
import { PlanResult, StudentProfile } from "@/lib/types";

function buildTerms(profile: StudentProfile) {
  return Array.from({ length: 8 }, (_, index) => ({
    termName: `Term ${index + 1} (${profile.startTerm})`,
    targetCredits: profile.preferredCreditsPerTerm,
    slots: [
      `Core Slot ${index + 1}A`,
      `Major Slot ${index + 1}B`,
      `Elective Slot ${index + 1}C`,
      "University Requirement Slot",
    ],
  }));
}

export async function POST(request: Request) {
  const payload = await request.json();
  const parsed = studentProfileSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid StudentProfile payload.",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const profile = parsed.data;

  const result: PlanResult = {
    generatedAt: new Date().toISOString(),
    terms: buildTerms(profile),
    checklist: [
      "Meet with advisor before registration.",
      "Verify prerequisite completion for next term slots.",
      "Track progress toward graduation minimum credits.",
    ],
    warnings: [TERM_AVAILABILITY_WARNING, ...POLICY_WARNINGS],
    adjustmentOptions: [
      "Shift one elective slot to summer term.",
      "Reduce target credits by 3 for high-load terms.",
      "Swap a placeholder major slot with internship/research credit.",
    ],
  };

  return NextResponse.json(result);
}
