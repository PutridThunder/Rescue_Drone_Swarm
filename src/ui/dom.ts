// Small DOM helpers shared by the HUD components.

/** Create an element with a class and inner HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", html = ""): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (html) el.innerHTML = html;
  return el;
}

/** querySelector that throws if the element is missing (a template bug, not a runtime state). */
export function $<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

/** Listen on `root` for events from descendants matching `selector`. */
export function delegate<T extends HTMLElement = HTMLElement>(
  root: HTMLElement,
  event: string,
  selector: string,
  handler: (target: T, e: Event) => void,
) {
  root.addEventListener(event, (e) => {
    const target = (e.target as HTMLElement).closest<T>(selector);
    if (target && root.contains(target)) handler(target, e);
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Only http(s) links are rendered as hrefs. */
export function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : "#";
}

/** Read/write a small per-browser preference; storage can be unavailable (private mode). */
export const prefs = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // not remembered; fine
    }
  },
};
