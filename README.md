# FrogNav (Next.js App Router)

Academic planning prototype built with:
- Next.js (App Router, TypeScript)
- Tailwind CSS
- shadcn/ui-style components
- React Hook Form + Zod

## Features
- `/` landing page with CTA to intake
- `/intake` multi-step wizard that collects `StudentProfile`
- `/plan` renders an 8-term grid, checklist, warnings, and adjustment options
- `/export` print-friendly plan view
- Local storage persistence for `StudentProfile` and `PlanResult`
- API route: `POST /api/plan` returns generated `PlanResult`

## Planner engine behavior
- Uses generic placeholder course slots (no hardcoded TCU requirements)
- Always includes warning:
  - `Term availability not provided; verify in TCU Class Search.`
- Always includes policy warnings from `lib/constants.ts`

## Validation and resiliency updates
- Shared Zod schemas for intake payloads, API validation, and persisted data parsing.
- `/api/plan` returns HTTP 400 with validation details for malformed payloads.
- Intake and plan pages display user-facing errors when plan generation fails.

## File structure

```text
.
├── app
│   ├── api/plan/route.ts
│   ├── export/page.tsx
│   ├── intake/page.tsx
│   ├── plan/page.tsx
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components
│   ├── plan-view.tsx
│   └── ui
│       ├── button.tsx
│       ├── card.tsx
│       ├── checkbox.tsx
│       ├── input.tsx
│       ├── label.tsx
│       └── textarea.tsx
├── lib
│   ├── constants.ts
│   ├── schemas.ts
│   ├── storage.ts
│   ├── types.ts
│   └── utils.ts
├── next.config.ts
├── package.json
├── postcss.config.mjs
├── tailwind.config.ts
└── tsconfig.json
```

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Build & lint

```bash
npm run lint
npm run build
```
