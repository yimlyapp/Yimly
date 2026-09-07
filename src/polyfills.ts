/**
 * Polyfills and compatibility shims for legacy browsers, specifically Safari on iOS 12.x.
 * This file is imported at the very top of src/main.tsx before any React code executes.
 */

// 1. globalThis polyfill
if (typeof globalThis === 'undefined') {
  (window as any).globalThis = window;
}

// 2. Promise.allSettled
if (!(Promise as any).allSettled) {
  (Promise as any).allSettled = function (promises: Iterable<any>) {
    return Promise.all(
      Array.from(promises).map(p =>
        Promise.resolve(p).then(
          value => ({ status: 'fulfilled', value }),
          reason => ({ status: 'rejected', reason })
        )
      )
    );
  };
}

// 3. Object.fromEntries
if (!(Object as any).fromEntries) {
  (Object as any).fromEntries = function (entries: any) {
    if (!entries) return {};
    const obj: any = {};
    for (const [key, val] of entries) {
      obj[key] = val;
    }
    return obj;
  };
}

// 4. String.prototype.replaceAll
if (!(String.prototype as any).replaceAll) {
  (String.prototype as any).replaceAll = function (searchValue: any, replaceValue: any): string {
    if (searchValue instanceof RegExp) {
      return this.replace(searchValue, replaceValue);
    }
    const escaped = String(searchValue).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.replace(new RegExp(escaped, 'g'), replaceValue);
  };
}

// 5. Array.prototype.flat and flatMap
if (!(Array.prototype as any).flat) {
  (Array.prototype as any).flat = function (depth = 1): any[] {
    const d = typeof depth === 'number' ? depth : 1;
    const arr: any[] = this as any;
    return d > 0
      ? arr.reduce((acc: any[], val: any) => acc.concat(Array.isArray(val) ? (val as any).flat(d - 1) : val), [])
      : arr.slice();
  };
}
if (!(Array.prototype as any).flatMap) {
  (Array.prototype as any).flatMap = function (callback: any, thisArg: any): any[] {
    const arr: any[] = this as any;
    return (arr.map(callback, thisArg) as any).flat(1);
  };
}

// 6. crypto.randomUUID
if (typeof window !== 'undefined' && typeof window.crypto !== 'undefined' && !window.crypto.randomUUID) {
  window.crypto.randomUUID = function (): `${string}-${string}-${string}-${string}-${string}` {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    }) as `${string}-${string}-${string}-${string}-${string}`;
  };
}

// 7. CustomEvent constructor for older WebKit
if (typeof window !== 'undefined' && typeof (window as any).CustomEvent !== 'function') {
  function CustomEventPolyfill(event: string, params?: { bubbles?: boolean; cancelable?: boolean; detail?: any }) {
    params = params || { bubbles: false, cancelable: false, detail: null };
    const evt = document.createEvent('CustomEvent');
    evt.initCustomEvent(event, params.bubbles || false, params.cancelable || false, params.detail);
    return evt;
  }
  CustomEventPolyfill.prototype = (window as any).Event.prototype;
  (window as any).CustomEvent = CustomEventPolyfill;
}

// 8. ResizeObserver polyfill / shim
if (typeof window !== 'undefined' && typeof (window as any).ResizeObserver === 'undefined') {
  class ResizeObserverPolyfill {
    private callback: (entries: any[], observer: any) => void;
    private targets = new Set<Element>();
    private listener: () => void;

    constructor(callback: (entries: any[], observer: any) => void) {
      this.callback = callback;
      this.listener = () => {
        const entries = Array.from(this.targets).map(el => {
          const rect = el.getBoundingClientRect();
          return {
            target: el,
            contentRect: rect,
            borderBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
            contentBoxSize: [{ inlineSize: rect.width, blockSize: rect.height }],
          };
        });
        if (entries.length > 0) {
          try {
            this.callback(entries, this);
          } catch (e) {
            console.warn('[ResizeObserver Polyfill] Error during callback:', e);
          }
        }
      };
      window.addEventListener('resize', this.listener);
      window.addEventListener('orientationchange', this.listener);
    }

    observe(target: Element) {
      if (target) {
        this.targets.add(target);
        // Trigger initial callback asynchronously
        requestAnimationFrame(this.listener);
      }
    }

    unobserve(target: Element) {
      this.targets.delete(target);
    }

    disconnect() {
      this.targets.clear();
      window.removeEventListener('resize', this.listener);
      window.removeEventListener('orientationchange', this.listener);
    }
  }

  (window as any).ResizeObserver = ResizeObserverPolyfill;
}

// 9. IntersectionObserver polyfill / shim
if (typeof window !== 'undefined' && typeof (window as any).IntersectionObserver === 'undefined') {
  class IntersectionObserverPolyfill {
    private callback: (entries: any[], observer: any) => void;
    private targets = new Set<Element>();

    constructor(callback: (entries: any[], observer: any) => void) {
      this.callback = callback;
    }

    observe(target: Element) {
      if (target) {
        this.targets.add(target);
        requestAnimationFrame(() => {
          try {
            this.callback([
              {
                isIntersecting: true,
                target,
                intersectionRatio: 1,
                boundingClientRect: target.getBoundingClientRect(),
                intersectionRect: target.getBoundingClientRect(),
                rootBounds: null,
                time: Date.now(),
              }
            ], this);
          } catch (e) {}
        });
      }
    }

    unobserve(target: Element) {
      this.targets.delete(target);
    }

    disconnect() {
      this.targets.clear();
    }
  }

  (window as any).IntersectionObserver = IntersectionObserverPolyfill;
}

// 10. Clipboard API fallback
if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
  if (!navigator.clipboard) {
    (navigator as any).clipboard = {
      writeText: async (text: string): Promise<void> => {
        try {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          textarea.style.left = '-9999px';
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          return Promise.resolve();
        } catch (err) {
          return Promise.reject(err);
        }
      },
      readText: async (): Promise<string> => {
        return Promise.resolve('');
      }
    };
  }
}

// 11. Flex Gap detection & Mobile Safari Viewport Height fix
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  // Test flex gap support
  function checkFlexGapSupport() {
    try {
      const flex = document.createElement('div');
      flex.style.display = 'flex';
      flex.style.flexDirection = 'column';
      flex.style.rowGap = '1px';
      flex.appendChild(document.createElement('div'));
      flex.appendChild(document.createElement('div'));
      document.body.appendChild(flex);
      const isSupported = flex.scrollHeight === 1;
      document.body.removeChild(flex);
      if (!isSupported) {
        document.documentElement.classList.add('no-flex-gap');
      }
    } catch (e) {
      // If error occurs, assume no flex gap
      document.documentElement.classList.add('no-flex-gap');
    }
  }

  // Set real viewport height for iOS Safari address bar quirks
  function setViewportHeight() {
    try {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      checkFlexGapSupport();
      setViewportHeight();
    });
  } else {
    checkFlexGapSupport();
    setViewportHeight();
  }

  window.addEventListener('resize', setViewportHeight);
  window.addEventListener('orientationchange', setViewportHeight);
}

export {};
