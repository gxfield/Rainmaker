import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/jetbrains-mono";
import "@/styles/globals.css";
import "@/styles/themes.css";
import { DirectionProvider } from "@/components/foundations/direction/direction";
import { App } from "@/app/App";
import { ToastProvider } from "@/app/ui";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DirectionProvider locale={navigator.language || "en-US"}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </DirectionProvider>
  </StrictMode>,
);
