import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-5xl font-bold">FrogNav Academic Planner</h1>
      <p className="max-w-xl text-lg text-muted-foreground">
        Build an editable 8-term plan with placeholder course slots, checklist items, and advisor-friendly warnings.
      </p>
      <Button asChild size="lg">
        <Link href="/intake">Start Intake Wizard</Link>
      </Button>
    </main>
  );
}
