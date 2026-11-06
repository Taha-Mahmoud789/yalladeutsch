import "../styles/style.css";

export const metadata = {
  title: "YallaDeutsch · hear it, type it, say it",
  description: "Train German listening, typing and shadowing with real native video clips.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: 'try { document.documentElement.dataset.theme = localStorage.getItem("klTheme") === "dark" ? "dark" : "white"; } catch {}' }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      {/* Browser extensions such as ColorZilla can add body attributes before hydration. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
