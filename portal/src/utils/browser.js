/**
 * browser.js — Browser environment detection utilities
 *
 * Language: JavaScript (plain, no TypeScript)
 * Purpose: WebGL support detection, DPR calculation, reduced-motion
 *          preference, and feature-gating without TypeScript overhead.
 */

/**
 * Detect the optimal devicePixelRatio for canvas rendering.
 * Capped at 2 to balance visual quality and performance.
 *
 * @returns {number} Effective pixel ratio (1 or 2)
 */
export function getEffectiveDPR() {
  if (typeof window === 'undefined') return 1;
  return Math.min(window.devicePixelRatio || 1, 2);
}

/**
 * Check whether the browser supports WebGL.
 *
 * @returns {{ supported: boolean, context: string|null }}
 */
export function checkWebGLSupport() {
  if (typeof document === 'undefined') {
    return { supported: false, context: null };
  }

  const testCanvas = document.createElement('canvas');
  let context = null;

  try {
    context =
      testCanvas.getContext('webgl2') ||
      testCanvas.getContext('webgl');
  } catch (_) {
    // WebGL may throw if blocked by permissions policy
  }

  return {
    supported: context !== null,
    context: context ? (context instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl') : null,
  };
}

/**
 * Check whether the user prefers reduced motion.
 *
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_) {
    return false;
  }
}

/**
 * Generate a simple numeric hash from a string.
 * Useful for deterministic marker colours or session seeds.
 *
 * @param {string} str
 * @returns {number} 32-bit unsigned integer hash
 */
export function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Debounce a function call — waits `ms` after last invocation.
 *
 * @param {Function} fn
 * @param {number} ms
 * @returns {Function}
 */
export function debounce(fn, ms) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
      timer = null;
    }, ms);
  };
}

/**
 * Clamp a number between min and max.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
