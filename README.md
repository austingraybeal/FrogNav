# FrogNav Agent Shell (Vercel Full-Stack)

FrogNav is now a single-platform Vercel deployment:
- Static frontend for intake + prompt generation
- Serverless backend endpoint (`/api/plan`) that calls OpenAI and returns `{ planText }`

## Project files

- `index.html` — UI structure
- `styles.css` — styling
- `app.js` — wizard logic, prompt generation, and `/api/plan` integration
- `api/plan.js` — Vercel serverless function that calls OpenAI Chat Completions

## Local run (no npm install required)

This repo has no build step and no runtime dependencies.

1. Start a local static server from the repo root:
   ```bash
   python -m http.server 8000
   ```
2. Open `http://localhost:8000`.

> Note: `/api/plan` runs as a Vercel serverless function in deployment. For local API testing, use Vercel CLI (`vercel dev`) if desired.

## Vercel deployment (click steps)

1. Push this repository to GitHub.
2. In Vercel, click **Add New... → Project**.
3. Import the GitHub repo.
4. In **Environment Variables**, add:
   - `OPENAI_API_KEY` = your OpenAI API key
5. Leave build settings at defaults (no build command required).
6. Click **Deploy**.

After deploy:
- Frontend is served by Vercel
- `/api/plan` is hosted by Vercel serverless and uses your `OPENAI_API_KEY`

## API contract

`POST /api/plan`

Request JSON:
```json
{
  "intake": { "majorProgram": "Movement Science" },
  "promptText": "..."
}
```

Response JSON:
```json
{
  "planText": "PLAN SUMMARY\n..."
}
```
