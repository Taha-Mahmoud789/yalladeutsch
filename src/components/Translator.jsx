"use client";

import { useEffect, useId, useRef, useState } from "react";

export default function Translator({ currentWord = false }) {
  const fieldId = useId();
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const suggestion = useRef("");
  const request = useRef(null);

  useEffect(() => {
    if (!currentWord) return;
    function suggest(event) {
      const previous = suggestion.current;
      suggestion.current = event.detail;
      setQuery((value) => !value || value === previous ? event.detail : value);
    }
    window.addEventListener("kl-clip-word", suggest);
    return () => window.removeEventListener("kl-clip-word", suggest);
  }, [currentWord]);

  useEffect(() => () => request.current?.abort(), []);

  async function translate(event) {
    event.preventDefault();
    const word = query.trim();
    if (!word) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/translate?q=" + encodeURIComponent(word), { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not translate this word.");
      if (!controller.signal.aborted) setResult({ word, text: data.translation });
    } catch (error) {
      if (!controller.signal.aborted) setResult({ word, error: error.message });
    } finally {
      if (request.current === controller) setLoading(false);
    }
  }

  return (
    <section className="translator" aria-labelledby={titleId}>
      <h2 id={titleId}>German → Arabic</h2>
      <form onSubmit={translate}>
        <label htmlFor={fieldId}>German word or phrase</label>
        <input id={fieldId} lang="de" autoComplete="off" maxLength={500} required
          placeholder="e.g. Kapital" value={query} onChange={(event) => setQuery(event.target.value)} />
        <button className="btn primary" type="submit" disabled={loading || !query.trim()}>
          {loading ? "Translating…" : "Translate"}
        </button>
      </form>
      <div className="translator-result" role="status">
        {loading && <p className="hint">Looking up the Arabic meaning…</p>}
        {result && <p className="translator-term" lang="de">{result.word}</p>}
        {result?.text && <p className="translator-arabic" lang="ar" dir="rtl">{result.text}</p>}
        {result?.error && <p className="hint">{result.error}</p>}
      </div>
    </section>
  );
}
