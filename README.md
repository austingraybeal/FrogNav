# FrogNav Agent Shell (Static)

This repository is a pure static website for collecting student intake information and generating a high-quality prompt for FrogNav GPT.

## Files

- `index.html` — UI structure
- `styles.css` — modern styling
- `app.js` — wizard logic, prompt generation, autosave, copy actions

## Run locally

No npm install or build is required.

- Option 1: Open `index.html` directly in your browser.
- Option 2: Serve the folder with any static server (example):

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## GitHub Pages setup

Enable GitHub Pages with:

- **Source:** Deploy from a branch
- **Branch:** `main`
- **Folder:** `/(root)`
