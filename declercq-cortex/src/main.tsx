// Buffer polyfill — gray-matter uses Buffer internally and the browser
// doesn't provide it natively. Must run before any code that imports
// gray-matter.
import { Buffer } from "buffer";
// @ts-expect-error widening globalThis with a Buffer shim
globalThis.Buffer = Buffer;

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
