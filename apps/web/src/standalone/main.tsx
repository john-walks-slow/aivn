import React from "react";
import { createRoot } from "react-dom/client";
import { StandalonePlayer } from "./StandalonePlayer.js";

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<StandalonePlayer />);
}
