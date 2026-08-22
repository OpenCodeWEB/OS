import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import App from "./App";
import "./index.css";

/* ------------------------------------------------------------------ */
/*  Register Service Worker for PWA offline support                    */
/* ------------------------------------------------------------------ */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then(
      (reg) => console.log("[PWA] SW registered:", reg.scope),
      (err) => console.warn("[PWA] SW registration failed:", err),
    );
  });
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root not found in DOM");
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
