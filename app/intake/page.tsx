"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { intakeFormSchema, IntakeFormValues, planResultSchema } from "@/lib/schemas";
import { loadProfile, savePlan, saveProfile } from "@/lib/storage";
import { StudentProfile } from "@/lib/types";

const STEP_ONE_FIELDS: (keyof IntakeFormValues)[] = ["major", "startTerm", "preferredCreditsPerTerm"];

export default function IntakePage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    trigger,
    handleSubmit,
    formState: { errors },
    setValue,
    setError,
  } = useForm<IntakeFormValues>({
    defaultValues: {
      major: "",
      startTerm: "",
      preferredCreditsPerTerm: 15,
      completedCourses: "",
      notes: "",
    },
  });

  useEffect(() => {
    const stored = loadProfile();
    if (!stored) return;

    setValue("major", stored.major);
    setValue("startTerm", stored.startTerm);
    setValue("preferredCreditsPerTerm", stored.preferredCreditsPerTerm);
    setValue("completedCourses", stored.completedCourses.join(", "));
    setValue("notes", stored.notes ?? "");
  }, [setValue]);

  const stepLabel = useMemo(() => (step === 1 ? "Program Basics" : "History and Notes"), [step]);

  const goToStepTwo = async () => {
    const valid = await trigger(STEP_ONE_FIELDS);
    if (valid) setStep(2);
  };

  const onSubmit = async (values: IntakeFormValues) => {
    setLoading(true);
    setSubmitError(null);

    const parsedForm = intakeFormSchema.safeParse(values);
    if (!parsedForm.success) {
      const flattened = parsedForm.error.flatten().fieldErrors;
      if (flattened.major?.[0]) setError("major", { message: flattened.major[0] });
      if (flattened.startTerm?.[0]) setError("startTerm", { message: flattened.startTerm[0] });
      if (flattened.preferredCreditsPerTerm?.[0]) {
        setError("preferredCreditsPerTerm", { message: flattened.preferredCreditsPerTerm[0] });
      }
      setLoading(false);
      return;
    }

    const safeValues = parsedForm.data;

    const profile: StudentProfile = {
      major: safeValues.major.trim(),
      startTerm: safeValues.startTerm.trim(),
      preferredCreditsPerTerm: safeValues.preferredCreditsPerTerm,
      completedCourses: safeValues.completedCourses
        ? safeValues.completedCourses
            .split(",")
            .map((course) => course.trim())
            .filter(Boolean)
        : [],
      notes: safeValues.notes?.trim() || undefined,
    };

    saveProfile(profile);

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
      const plan = planResultSchema.parse(payload);
      savePlan(plan);
      router.push("/plan");
    } catch {
      setSubmitError("Unable to generate a plan right now. Please review your inputs and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>Intake Wizard (Step {step} of 2)</CardTitle>
          <p className="text-sm text-muted-foreground">{stepLabel}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="major">Major</Label>
                  <Input id="major" {...register("major", { required: "Major is required" })} />
                  {errors.major && <p className="text-sm text-red-600">{errors.major.message}</p>}
                </div>
                <div>
                  <Label htmlFor="startTerm">Start Term</Label>
                  <Input id="startTerm" placeholder="Fall 2026" {...register("startTerm", { required: "Start term is required" })} />
                  {errors.startTerm && <p className="text-sm text-red-600">{errors.startTerm.message}</p>}
                </div>
                <div>
                  <Label htmlFor="preferredCreditsPerTerm">Preferred Credits Per Term</Label>
                  <Input
                    id="preferredCreditsPerTerm"
                    type="number"
                    {...register("preferredCreditsPerTerm", {
                      required: "Preferred credits are required",
                      valueAsNumber: true,
                      min: { value: 9, message: "Must be at least 9 credits" },
                      max: { value: 18, message: "Must be no more than 18 credits" },
                    })}
                  />
                  {errors.preferredCreditsPerTerm && (
                    <p className="text-sm text-red-600">{errors.preferredCreditsPerTerm.message}</p>
                  )}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="completedCourses">Completed Courses (comma separated)</Label>
                  <Textarea id="completedCourses" {...register("completedCourses")} />
                </div>
                <div>
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea id="notes" {...register("notes")} />
                </div>
              </div>
            )}

            {submitError && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{submitError}</p>}

            <div className="flex justify-between gap-2">
              <Button type="button" variant="outline" disabled={step === 1 || loading} onClick={() => setStep(1)}>
                Back
              </Button>
              {step === 1 ? (
                <Button type="button" onClick={() => void goToStepTwo()} disabled={loading}>
                  Next
                </Button>
              ) : (
                <Button type="submit" disabled={loading}>
                  {loading ? "Generating..." : "Generate Plan"}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
