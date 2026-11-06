import Translator from "./Translator";

export default function HomeView() {
  return (
    <section id="view-home" className="view">
      <div className="tabs" role="group" aria-label="Workspace">
        <button className="tab on" data-tab="listen" type="button" aria-pressed="true" aria-controls="panel-listen">Listen</button>
        <button className="tab" data-tab="library" type="button" aria-pressed="false" aria-controls="panel-library">Library</button>
        <button className="tab" data-tab="corpus" type="button" aria-pressed="false" aria-controls="panel-corpus">My clips</button>
      </div>

      {/* LISTEN panel: pronunciation search results in our own player + handoff into trainer */}
      <div className="panel" id="panel-listen">
        <header className="section-heading">
          <h1>Hear German in context.</h1>
          <p>Find a word, hear how people say it, then practice the line.</p>
        </header>
        <form id="search-form" className="search-shell" autoComplete="off">
          <input id="q" aria-label="German word or phrase" placeholder="Try trotzdem or zu Hause" required />
          <button className="btn primary" type="submit">Find clips</button>
        </form>
        <div className="yg-layout">
          <div className="listen-media">
          <div className="yg-stage">
            <button className="btn ghost yg-arrow" id="yg-prev" type="button" aria-label="Previous clip" disabled>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>
            </button>
            <div className="yg-well">
              <div id="yg-widget"></div>
              <p id="yg-empty" className="yg-empty">
                <svg viewBox="0 0 100 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M4 24h8m8-7v14m10-21v28m10-33v38m10-29v20m10-25v30m10-21v12m10-16v20m8-10h8"/></svg>
                <span>Search for a German word to play a clip.</span>
              </p>
            </div>
            <button className="btn ghost yg-arrow" id="yg-next" type="button" aria-label="Next clip" disabled>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
            </button>
          </div>
            <div className="yg-handoff" id="yg-handoff" aria-label="Playback controls">
              <p id="yg-position" className="hint" aria-live="polite">No clip selected</p>
              <div id="yg-actions" className="yg-actions" hidden>
                <button className="btn ghost" id="yg-replay" type="button">Replay clip</button>
                <button className="btn cyan" id="yg-train" type="button">Start typing</button>
              <div id="yg-playback-error" hidden>
                <p className="hint" id="yg-playback-message" role="status" />
                <div className="row">
                  <button className="btn ghost" id="yg-playback-next" type="button">Try next clip</button>
                  <a className="btn ghost" id="yg-watch" target="_blank" rel="noopener noreferrer">Watch on YouTube</a>
                </div>
              </div>
              <p className="hint" id="yg-train-status" role="status"></p>
              <button className="btn ghost" id="yg-try-next" type="button" hidden>Try next clip</button>
              </div>
            </div>
          </div>
          <aside className="yg-sidebar" aria-label="Translation and word discovery">
            <Translator currentWord />
            <div className="yg-volume-panel">
              <label className="yg-volume-label" htmlFor="yg-volume">Volume <output id="yg-volume-value" htmlFor="yg-volume">100%</output></label>
              <input id="yg-volume" type="range" min="0" max="100" step="1" defaultValue="100" />
            </div>
            <section className="hero card">
              <div id="hero-thumb" hidden aria-hidden="true"></div>
              <button className="btn ghost mini hero-reroll" id="reroll" aria-label="Pick another B1 word" title="Pick another B1 word" type="button">↻</button>
              <div className="hero-word-row"><span>Random B1 word</span>
                <span id="hero-word" className="hero-word">…</span>
              </div>
              <div id="hero-info" className="hint">rolling…</div>
              <button id="hero-go" className="btn ghost" disabled>Try this word</button>
            </section>
          </aside>
        </div>
      </div>

      {/* LIBRARY panel: video catalog */}
      <div className="panel" id="panel-library" hidden>
        <header className="section-heading"><h1>Video library</h1><p>Pick a German video to practice, or bring a YouTube link with captions.</p></header>
        <div className="row" style={{ marginBottom: "14px" }}>
          <button className="btn ghost mini" id="lib-reload" type="button">↻ refresh</button>
          <span className="hint" id="lib-status">loading catalog…</span>
        </div>
        <div className="grid" id="lib-grid"></div>
        <details className="fold">
          <summary>Load a YouTube URL</summary>
          <form id="url-form" autoComplete="off" className="row" style={{ marginTop: "10px" }}>
            <input id="url-input" placeholder="https://youtube.com/watch?v=… (German captions)" style={{ flex: 1, minWidth: "220px" }} required />
            <button className="btn" type="submit">Load</button>
          </form>
          <p className="hint">Easy German, DW, Tagesschau clips almost always have German captions.</p>
        </details>
        <details className="fold" id="relay-box">
          <summary>Optional caption relay</summary>
          <p className="hint">
            Local development and Vercel include a caption relay. To add a fallback, deploy
            <code>worker.js</code> on Cloudflare Workers (free) and paste the
            <code>*.workers.dev</code> URL here.
          </p>
          <form id="relay-form" autoComplete="off" className="row">
            <input id="relay-url" placeholder="https://your-relay.workers.dev" style={{ flex: 1 }} />
            <button className="btn" type="submit">Save</button>
          </form>
        </details>
      </div>

      {/* CORPUS panel: locally indexed clips + word search + SRS */}
      <div className="panel" id="panel-corpus" hidden>
        <header className="section-heading"><h1>My clips</h1><p>Find a line you saved and review words you missed.</p></header>
        <div className="row" style={{ marginBottom: "12px" }}>
          <button className="btn" id="seed" type="button">Add German channels · 5 each</button>
          <button className="btn ghost" id="review" type="button">Review due words</button>
          <button className="btn ghost" id="export" type="button">Export</button>
          <label className="btn ghost" htmlFor="import-file" style={{ position: "relative" }}>
            Import
            <input type="file" id="import-file" accept=".json" hidden />
          </label>
        </div>
        <p className="muted-line" id="corpus-line"></p>
        <p className="muted-line" id="stats-line"></p>
        <form id="q-form" autoComplete="off" className="search-shell" >
          <input id="cq" aria-label="Search saved sentences" placeholder="Search saved sentences" />
          <button className="btn" type="submit">Search</button>
        </form>
        <div id="q-results"></div>
        <div id="paste-fallback" hidden>
          <p id="home-msg" className="hint"></p>
          <textarea id="sub-text" placeholder="Paste .vtt or .srt captions here…" style={{ width: "100%", minHeight: "110px", margin: "8px 0" }}></textarea>
          <button className="btn ghost" id="use-pasted" type="button">Use these captions</button>
        </div>
      </div>

      <p className="foot">
        Your progress stays in this browser (export to back up).
      </p>
    </section>
  );
}
