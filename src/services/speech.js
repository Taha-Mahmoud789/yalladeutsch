// klanger — Web Speech recognition + mic capture (Chrome/Edge; feature-detected).
// ponytail: recordings are blob-per-session, never persisted; revoke on replace.

export function speechSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition) &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export function listenOnce(lang = "de-DE", timeoutMs = 9000) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  return new Promise((res, rej) => {
    if (!SR) return rej(new Error("speech not supported in this browser"));
    const rec = new SR();
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; try { rec.stop(); } catch { /* already stopped */ } fn(v); } };
    const t = setTimeout(() => done(rej, new Error("no speech detected — speak a bit louder")), timeoutMs);
    rec.onresult = (e) => { clearTimeout(t); done(res, e.results[0][0].transcript); };
    rec.onerror = (e) => {
      clearTimeout(t);
      done(rej, new Error(
        e.error === "not-allowed" ? "microphone blocked — allow it in the address bar" :
        e.error === "no-speech" ? "no speech detected" :
        "speech error: " + e.error));
    };
    rec.onend = () => { clearTimeout(t); done(rej, new Error("mic closed before a sentence was caught")); };
    try { rec.start(); } catch (err) { done(rej, err); }
  });
}

export async function startRecorder() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const chunks = [];
  const mr = new MediaRecorder(stream);
  mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  mr.start();
  return {
    stop: () => new Promise((res) => {
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        res(new Blob(chunks, { type: mr.mimeType || "audio/webm" }));
      };
      mr.stop();
    }),
  };
}
