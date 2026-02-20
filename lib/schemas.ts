import { z } from "zod";

export const studentProfileSchema = z.object({
  major: z.string().trim().min(2, "Major is required"),
  startTerm: z.string().trim().min(2, "Start term is required"),
  preferredCreditsPerTerm: z.number().min(9).max(18),
  completedCourses: z.array(z.string().trim()).default([]),
  notes: z.string().trim().optional(),
});

export const planResultSchema = z.object({
  generatedAt: z.string(),
  checklist: z.array(z.string()),
  warnings: z.array(z.string()),
  adjustmentOptions: z.array(z.string()),
  terms: z.array(
    z.object({
      termName: z.string(),
      targetCredits: z.number(),
      slots: z.array(z.string()),
    }),
  ),
});

export const intakeFormSchema = z.object({
  major: z.string().trim().min(2, "Major is required"),
  startTerm: z.string().trim().min(2, "Start term is required"),
  preferredCreditsPerTerm: z.coerce.number().min(9).max(18),
  completedCourses: z.string().optional(),
  notes: z.string().optional(),
});

export type IntakeFormValues = z.infer<typeof intakeFormSchema>;
