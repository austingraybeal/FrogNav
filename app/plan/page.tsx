"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlanView } from "@/components/plan-view";
import { Button } from "@/components/ui/button";
import { loadPlan, loadProfile, savePlan } from "@/lib/storage";
import { planResultSchema } from "@/lib/schemas";
import { PlanResult, StudentProfile } from "@/lib/types";

export default function PlanPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const storedProfile = loadProfile();
    const storedPlan = loadPlan();

    if (!storedProfile || !storedPlan) {
      router.push("/intake");
      return;
    }

    setProfile(storedProfile);
    setPlan(storedPlan);
    setIsLoading(false);
  }, [router]);

  const regenerate = async () => {
    if (!profile) return;

    setError(null);

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });

      if (!response.ok) {
        throw new Error(`Planner API returned ${response.status}`);
      }

      const payload = await response.json();
      const nextPlan = planResultSchema.parse(payload);
      savePlan(nextPlan);
      setPlan(nextPlan);
    } catch {
      setError("Could not regenerate the plan. Please try again.");
    }
  };

  if (isLoading) {
    return <main className="p-6 text-sm text-muted-foreground">Loading your plan...</main>;
  }

  if (!profile || !plan) {
    return (
      <main className="space-y-3 p-6">
        <p>No saved profile or plan found.</p>
        <Button asChild>
          <Link href="/intake">Go to Intake</Link>
        </Button>
      </main>
    );
  }

  return (
    <>
      {error && <p className="mx-auto mt-6 max-w-6xl rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <PlanView profile={profile} plan={plan} onRegenerate={regenerate} />
    </>
  );
}
