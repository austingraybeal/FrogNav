# FrogForward — Claude Code Rules

## Project
TCU Kinesiology AI degree-planning advisor.
Pure HTML/CSS/JS. Deployed on Vercel via auto-deploy from main.

## Files
- index.html — main page
- styles.css — all styling
- app.js — all JS logic
- frog.png — logo (NEVER touch)
- /api — Vercel serverless functions
- /data — course/degree data

## Critical Rules
1. NEVER rebuild files from scratch. Only make the exact change requested.
2. ONE change at a time. Confirm before moving to the next.
3. NEVER touch the header, frog logo, or branding.
4. NEVER alter text content unless explicitly asked.
5. Before every edit, state what IS and IS NOT being changed.
6. Pure CSS preferred. JS positioning accepted when CSS fails.
7. ZERO PLACEHOLDERS POLICY: The plan output shown to students must NEVER contain
   placeholder course codes (anything with "CORE", "ELECTIVE", "GENED-", "TCU-CORE-",
   "FREE-ELECTIVE", or any invented variant like "SOCI-CORE", "HUMANITIES-CORE", etc.).
   The server-side normalizePlan() in /api/plan.js resolves ALL placeholders to real
   TCU course codes via isPlaceholder(), genedAliases, genedFallbacks, and the keyword
   catch-all. If the AI invents a new placeholder pattern and it leaks through to the UI,
   the fix is ALWAYS in normalizePlan() — expand isPlaceholder(), add the new pattern to
   genedAliases, or extend the keyword catch-all. NEVER rely on prompt instructions alone
   to prevent placeholders; the server MUST catch them.
