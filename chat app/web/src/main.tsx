import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initTheme } from "./app/theme";
import { ToastProvider } from "./ui/Toast";
import "./styles.css";

initTheme();

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");

if (import.meta.env.DEV && window.location.hash.startsWith("#/__calls")) {
  // Development-only visual preview of call states (tree-shaken from production builds).
  void import("./dev/CallPreview").then(({ CallPreview }) => createRoot(root).render(<CallPreview />));
} else createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
