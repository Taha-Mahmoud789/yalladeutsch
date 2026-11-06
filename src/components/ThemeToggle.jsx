"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
  }, []);

  function toggleTheme() {
    const next = !dark;
    document.documentElement.dataset.theme = next ? "dark" : "white";
    localStorage.setItem("klTheme", next ? "dark" : "white");
    setDark(next);
  }

  return (
    <button className="theme-toggle" type="button" aria-pressed={dark} onClick={toggleTheme}>
      Dark mode
    </button>
  );
}
