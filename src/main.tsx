import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";
import App from "./App";
import QuickSearch from "./features/quick/QuickSearch";
import { ToastProvider } from "./components/Toast";

// One bundle, two windows: the vault window, and the quick search popup loaded with #quick.
const quick = window.location.hash === "#quick";
if (quick) document.documentElement.dataset.window = "quick";

// Main resolves "system" to classic or dark; the tokens for each live in index.css.
const setTheme = (theme: string | null) => {
  document.documentElement.dataset.theme = theme ?? "classic";
};
setTheme(new URLSearchParams(window.location.search).get("theme"));
window.kapevault?.onTheme(setTheme);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {quick ? (
      <ToastProvider>
        <QuickSearch />
      </ToastProvider>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
