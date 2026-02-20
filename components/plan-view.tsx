"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PlanResult, StudentProfile } from "@/lib/types";

export function PlanView({
  profile,
  plan,
  onRegenerate,
}: {
  profile: StudentProfile;
  plan: PlanResult;
  onRegenerate?: () => Promise<void>;
}) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Your 8-Term Plan</h1>
          <p className="text-muted-foreground">Major: {profile.major}</p>
        </div>
        <div className="flex gap-2">
          {onRegenerate && (
            <Button variant="outline" onClick={() => void onRegenerate()}>
              Regenerate Plan
            </Button>
          )}
          <Button asChild>
            <Link href="/export">Print/Export</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Term Grid</CardTitle>
          <CardDescription>Placeholder slot recommendations per term.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {plan.terms.map((term) => (
            <div key={term.termName} className="rounded-lg border p-3">
              <h3 className="font-semibold">{term.termName}</h3>
              <p className="mb-2 text-xs text-muted-foreground">Target credits: {term.targetCredits}</p>
              <ul className="list-disc space-y-1 pl-4 text-sm">
                {term.slots.map((slot) => (
                  <li key={slot}>{slot}</li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Checklist</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-4 text-sm">
              {plan.checklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Warnings</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-4 text-sm text-red-700">
              {plan.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Adjustment Options</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-4 text-sm">
              {plan.adjustmentOptions.map((option) => (
                <li key={option}>{option}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
