import Script from "next/script";
import HomeView from "../components/HomeView";
import TrainerView from "../components/TrainerView";
import PracticeBootstrap from "../components/PracticeBootstrap";
import ThemeToggle from "../components/ThemeToggle";

export default function Page() {
  return (
    <>
      <header className="topbar">
        <a className="brand" id="brand" href="/">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M3 12h3m3-4v8m3-12v16m3-12v8m3-4h3" />
          </svg>
          <em>YallaDeutsch</em>
        </a>
        <span id="streak-chip" className="chip" />
        <ThemeToggle />
      </header>
      <main>
        <HomeView />
        <TrainerView />
      </main>
      <div id="toast" role="status" />
      <Script src="https://www.youtube.com/iframe_api" strategy="afterInteractive" />
      <PracticeBootstrap />
    </>
  );
}
