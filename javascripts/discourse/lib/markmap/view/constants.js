export const DEBOUNCE_DELAY = 200;

export const isMacintosh =
  typeof navigator !== "undefined" && navigator.userAgent.includes("Macintosh");

export const defaultOptions = {
  autoFit: true,
  duration: 500,
  embedGlobalCSS: true,
  fitRatio: 0.95,
  maxWidth: 0,
  nodeMinHeight: 16,
  paddingX: 8,
  scrollForPan: isMacintosh,
  spacingHorizontal: 80,
  spacingVertical: 5,
  initialExpandLevel: -1,
  zoom: true,
  pan: true,
  toggleRecursively: false,
};
