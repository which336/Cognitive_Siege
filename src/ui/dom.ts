/** Tiny helpers for building DOM overlays without a framework. */

export type DomOpts = {
  cls?: string;
  text?: string;
  html?: string;
  attrs?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (ev: Event) => void>>;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: DomOpts = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (opts.cls) e.className = opts.cls;
  if (opts.text !== undefined) e.textContent = opts.text;
  if (opts.html !== undefined) e.innerHTML = opts.html;
  if (opts.attrs) {
    for (const k in opts.attrs) e.setAttribute(k, opts.attrs[k]);
  }
  if (opts.on) {
    for (const k in opts.on) {
      const fn = opts.on[k as keyof HTMLElementEventMap];
      if (fn) e.addEventListener(k, fn);
    }
  }
  for (const c of children) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

export function mountOverlay(root: HTMLElement): { close: () => void } {
  const overlay = el('div', { cls: 'cs-overlay' }, [root]);
  document.body.appendChild(overlay);
  return {
    close: () => {
      overlay.style.transition = 'opacity 0.25s ease';
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 260);
    },
  };
}

/** Typewriter effect - returns a Promise that resolves once complete. */
export function typewriter(target: HTMLElement, text: string, msPerChar = 28): Promise<void> {
  return new Promise(resolve => {
    target.textContent = '';
    let i = 0;
    const step = () => {
      if (i >= text.length) return resolve();
      target.textContent = text.slice(0, ++i);
      setTimeout(step, msPerChar);
    };
    step();
  });
}
