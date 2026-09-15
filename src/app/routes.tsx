/* eslint-disable react-refresh/only-export-components -- route table, not a component module */
import { lazy } from "react";
import { createHashRouter, Navigate } from "react-router";
import AppShell from "./AppShell";

const LandingPage = lazy(() => import("@/features/landing/LandingPage"));
const MapPage = lazy(() => import("@/features/map/MapPage"));
const AnalysesPage = lazy(() => import("@/features/analyses/AnalysesPage"));
const AlertsPage = lazy(() => import("@/features/alerts/AlertsPage"));

export const router = createHashRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <LandingPage /> },
      { path: "map", element: <MapPage /> },
      { path: "analyses", element: <AnalysesPage /> },
      { path: "alerts", element: <AlertsPage /> },
      { path: "*", element: <Navigate to="/map" replace /> },
    ],
  },
]);
