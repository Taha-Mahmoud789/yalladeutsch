import Translator from "./Translator";

export default function TrainerView() {
  return (
    <section id="view-player" className="view" hidden>
      <div className="stage">
        <header className="section-heading"><h1>Clip practice</h1></header>
        <div className="stagerow">
          <button className="btn ghost mini" id="back" type="button">← Home</button>
          <span id="cap-src" className="hint"></span>
          <div className="modes" role="group" aria-label="Practice mode">
            <button className="mode" data-mode="listen" type="button">Listen<small>replay · loop · speed</small></button>
            <button className="mode on" data-mode="type" type="button">Type<small>dictation · scoring</small></button>
            <button className="mode" data-mode="shadow" type="button" id="mode-shadow">Shadow<small>mic · pronunciation</small></button>
          </div>
        </div>

        <div id="segbar">
          <span id="seg-frac" className="hint">Segment –</span>
          <div className="segtrack" id="seg-track" aria-hidden="true"></div>
          <button className="btn primary mini" id="seg-run" type="button">Practice segment</button>
          <button className="btn ghost mini" id="seg-exit" type="button" hidden>Exit run</button>
        </div>

        <div className="practice-media">
        <div id="player-wrap"><div id="player"></div></div>

        <div id="stat-strip">
          <div className="stats">
            <span className="stat" id="st-line">Line –</span>
            <span className="stat" id="st-wpm">WPM –</span>
            <span className="stat" id="st-acc">Acc –</span>
          </div>
          <div className="transport">
            <button className="tbtn" id="prev-cue" type="button" title="Previous line" aria-label="Previous line">◀</button>
            <button className="tbtn" id="replay" type="button" title="Replay line" aria-label="Replay line">▶</button>
            <button className="tbtn" id="loop" type="button" title="Loop line" aria-label="Loop line">∞</button>
            <button className="tbtn" id="next-cue" type="button" title="Next line" aria-label="Next line">→</button>
          </div>
          <span className="stat" id="st-time">0:00 / 0:00</span>
        </div>

        <aside className="practice-options" aria-labelledby="practice-options-title">
          <h2 id="practice-options-title">Practice options</h2>
          <div id="controls">
            <label className="hint"><input type="checkbox" id="strict" /> Strict case &amp; ß</label>
            <label>Chunks
              <select id="word-limit" title="Words per typed part">
                <option value="0">Line</option>
                <option value="5">Easy · 5</option>
                <option value="7">Medium · 7</option>
                <option value="10">Hard · 10</option>
              </select>
            </label>
            <label className="switch" title="Hearing only — hides the transcript so you type from audio alone">
              <input type="checkbox" id="nocap" />
              <span className="sw" aria-hidden="true"></span>
              <span>Hearing only</span>
            </label>
            <label>Speed
              <select id="speed" defaultValue="1">
                <option value="0.5">0.5×</option>
                <option value="0.75">0.75×</option>
                <option value="1">1×</option>
                <option value="1.25">1.25×</option>
              </select>
            </label>
          </div>
        </aside>
        </div>

        <div className="practice-work">
        <div id="current-cue" aria-live="off"></div>

        <Translator />
        <div className="cuebar"><button className="btn ghost mini" id="cue-toggle" type="button">Transcript</button></div>
        <aside id="cue-list" aria-label="Transcript" hidden></aside>
        </div>
      </div>
    </section>
  );
}
