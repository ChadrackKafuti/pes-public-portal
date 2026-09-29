import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import "@esri/calcite-components/main.css";
import "@arcgis/map-components/main.css";
import "@/theme/global.css";
import { getLang } from "@/i18n";
import { ErrorBoundary } from "./ErrorBoundary";
import { router } from "./routes";

document.documentElement.lang = getLang();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  </StrictMode>,
);
