import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./index.css";
import App from "./App";
import { applyLanguage } from "./i18n";
import { applyTheme, loadPrefs } from "./lib/prefs";

const prefs = loadPrefs();
applyTheme(prefs.theme, prefs.palette);
applyLanguage(prefs.language);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
