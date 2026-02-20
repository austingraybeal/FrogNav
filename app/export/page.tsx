"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { loadPlan, loadProfile } from "@/lib/storage";
import { PlanResult, StudentProfile } from "@/lib/types";

export default function ExportPage() {
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [plan, setPlan] = useState<PlanResult | null>(null);

  useEffect(() => {
    setProfile(loadProfile());
    setPlan(loadPlan());
  }, []);

  if (!profile || !plan) {
    return (
      <main className="space-y-3 p-6">
        <p>No saved plan found.</p>
        <Button asChild>
          <Link href="/intake">Start Intake</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6 print:max-w-none print:p-0">
      <h1 className="text-2xl font-bold">FrogNav Plan Export</h1>
      <p>Major: {profile.major}</p>
      <p>Start Term: {profile.startTerm}</p>
      <p>Generated: {new Date(plan.generatedAt).toLocaleString()}</p>

      <section>
        <h2 className="mb-2 font-semibold">8-Term Grid</h2>
        <div className="grid gap-3 md:grid-cols-2 print:grid-cols-2">
          {plan.terms.map((term) => (
            <div key={term.termName} className="break-inside-avoid rounded border p-3">
              <h3 className="font-medium">{term.termName}</h3>
              <p className="text-sm text-muted-foreground">Target credits: {term.targetCredits}</p>
              <ul className="list-disc pl-4 text-sm">
                {term.slots.map((slot) => (
                  <li key={slot}>{slot}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-semibold">Checklist</h2>
        <ul className="list-disc pl-4 text-sm">
          {plan.checklist.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-semibold">Warnings</h2>
        <ul className="list-disc pl-4 text-sm">
          {plan.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-semibold">Adjustment Options</h2>
        <ul className="list-disc pl-4 text-sm">
          {plan.adjustmentOptions.map((option) => (
            <li key={option}>{option}</li>
          ))}
        </ul>
      </section>

      <button onClick={() => window.print()} className="rounded bg-black px-4 py-2 text-white print:hidden">
        Print
      </button>
    </main>
  );
}
