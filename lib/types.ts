import { z } from "zod";
import { planResultSchema, studentProfileSchema } from "@/lib/schemas";

export type StudentProfile = z.infer<typeof studentProfileSchema>;

export type TermPlan = {
  termName: string;
  targetCredits: number;
  slots: string[];
};

export type PlanResult = z.infer<typeof planResultSchema>;
