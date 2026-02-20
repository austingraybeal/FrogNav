export default function App() {
  return (
    <div className="page">
      <header className="header">
        <div className="brand">
          <div className="logo" aria-hidden="true">F</div>
          <div>
            <div className="title">FrogNav</div>
            <div className="subtitle">TCU AI Degree Planning Advisor</div>
          </div>
        </div>

        <nav className="nav">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#cta" className="btn btn-ghost">Get started</a>
        </nav>
      </header>

      <main className="main">
        <section className="hero">
          <div className="hero-copy">
            <h1>Plan your TCU degree path faster - with guardrails.</h1>
            <p>
              FrogNav helps you map semesters, prerequisites, and workload balance.
              Start simple now; expand into a full planning assistant over time.
            </p>

            <div className="hero-actions" id="cta">
              <button className="btn btn-primary" type="button">
                Start planning
              </button>
              <button className="btn btn-secondary" type="button">
                View sample plan
              </button>
            </div>

            <div className="hero-meta">
              <span className="pill">Prereq-aware</span>
              <span className="pill">Semester-by-semester</span>
              <span className="pill">WIP</span>
            </div>
          </div>

          <div className="hero-card" role="region" aria-label="Preview">
            <div className="card">
              <div className="card-title">Preview</div>
              <div className="card-body">
                <div className="row">
                  <div className="label">Major</div>
                  <div className="value">Movement Science</div>
                </div>
                <div className="row">
                  <div className="label">Start term</div>
                  <div className="value">Fall 2026</div>
                </div>
                <div className="row">
                  <div className="label">Target graduation</div>
                  <div className="value">Spring 2030</div>
                </div>
                <div className="divider" />
                <div className="small">Next: build the planner form + course rules.</div>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="features">
          <h2>What it will do</h2>
          <div className="grid">
            <div className="feature">
              <div className="feature-title">Prerequisite checks</div>
              <p>Warns you when a course sequence is invalid.</p>
            </div>
            <div className="feature">
              <div className="feature-title">Workload balance</div>
              <p>Helps distribute credit hours and tough courses across terms.</p>
            </div>
            <div className="feature">
              <div className="feature-title">Plan export</div>
              <p>Export a shareable plan (PDF/CSV) for advising.</p>
            </div>
          </div>
        </section>

        <section className="section" id="how">
          <h2>How it works</h2>
          <ol className="steps">
            <li>Pick your program and starting term.</li>
            <li>Enter completed courses/AP/transfer credit.</li>
            <li>Generate a draft plan and iterate.</li>
          </ol>
        </section>

        <footer className="footer">
          <div>Â© {new Date().getFullYear()} FrogNav</div>
          <div className="footer-links">
            <a href="https://github.com/austingraybeal/FrogNav" target="_blank" rel="noreferrer">
              GitHub
            </a>
          </div>
        </footer>
  </main>
    </div>
  )
}

