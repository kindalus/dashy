// Kept external to Vite's development module runner. These are trusted server
// modules, never files exposed through the browser's /@fs endpoint.
export const importConfig = (url) => import(/* @vite-ignore */ url);
