/**
 * Type declarations for browser.js utilities
 */
export function getEffectiveDPR(): number;
export function checkWebGLSupport(): {
  supported: boolean;
  context: string | null;
};
export function prefersReducedMotion(): boolean;
export function simpleHash(str: string): number;
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms: number,
): T;
export function clamp(value: number, min: number, max: number): number;
