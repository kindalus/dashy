/**
 * Print and "Save as PDF" support. While printing, tables show every row (not
 * one page) and charts scale to the paper width. Browser-only; installed once.
 */
import { createSignal, flush } from "solid-js";

const [printing, setPrinting] = createSignal(false);
export { printing };

let installed = false;
export function installPrint() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  // data-printing switches dark themes to the print palette at once, so charts re-render
  // (still, without animation) in print colours; charts.ts adds a viewBox for scaling.
  // The re-render finishes in microtasks, before the browser lays out the print.
  const before = () => {
    document.documentElement.setAttribute("data-printing", "");
    setPrinting(true);
    flush();
  };
  const after = () => {
    document.documentElement.removeAttribute("data-printing");
    setPrinting(false);
    flush();
  };
  addEventListener("beforeprint", before);
  addEventListener("afterprint", after);
  // Some print paths (headless PDF, older engines) only switch the print media query.
  matchMedia("print").addEventListener("change", (event) => (event.matches ? before() : after()));
}
