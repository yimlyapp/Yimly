/**
 * Authentication persistence and HTTP header management.
 * Provides safe storage access with in-memory fallback for legacy browsers
 * (such as Safari on iOS 10 in Private Browsing mode where localStorage throws).
 */

let memoryToken: string | null = null;

export function getAuthToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    const stored = localStorage.getItem('yimly_token');
    if (stored) {
      memoryToken = stored;
      return stored;
    }
  } catch (e) {
    // Safari Private Browsing mode or storage restricted
  }
  try {
    const stored = sessionStorage.getItem('yimly_token');
    if (stored) {
      memoryToken = stored;
      return stored;
    }
  } catch (e) {}
  return null;
}

export function setAuthToken(token: string): void {
  if (!token) return;
  memoryToken = token;
  try {
    localStorage.setItem('yimly_token', token);
  } catch (e) {
    console.warn('[AUTH] localStorage.setItem failed, using fallback:', e);
  }
  try {
    sessionStorage.setItem('yimly_token', token);
  } catch (e) {}
}

export function clearAuthToken(): void {
  memoryToken = null;
  try {
    localStorage.removeItem('yimly_token');
  } catch (e) {}
  try {
    sessionStorage.removeItem('yimly_token');
  } catch (e) {}
}

/**
 * Patch window.fetch once at startup so that all relative API requests
 * automatically include the Authorization Bearer header if a token exists.
 * This guarantees Safari 10 and browsers that block or drop cookies stay authenticated.
 */
let isFetchPatched = false;

export function initAuthFetchInterceptor(): void {
  if (isFetchPatched || typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return;
  }
  isFetchPatched = true;

  const originalFetch = window.fetch;

  const authFetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const token = getAuthToken();
    if (token) {
      let urlString = '';
      if (typeof input === 'string') {
        urlString = input;
      } else if (input instanceof URL) {
        urlString = input.toString();
      } else if (input && typeof input === 'object' && 'url' in input) {
        urlString = (input as Request).url;
      }

      const isApiCall = urlString.startsWith('/api/') || 
                        urlString.startsWith(window.location.origin + '/api/');

      if (isApiCall) {
        init = init ? { ...init } : {};

        if (!init.headers) {
          init.headers = { 'Authorization': `Bearer ${token}` };
        } else if (init.headers instanceof Headers) {
          if (!init.headers.has('Authorization')) {
            init.headers.set('Authorization', `Bearer ${token}`);
          }
        } else if (Array.isArray(init.headers)) {
          const hasAuth = init.headers.some(([k]) => k.toLowerCase() === 'authorization');
          if (!hasAuth) {
            init.headers.push(['Authorization', `Bearer ${token}`]);
          }
        } else if (typeof init.headers === 'object') {
          const headersRecord = init.headers as Record<string, string>;
          const hasAuth = Object.keys(headersRecord).some(k => k.toLowerCase() === 'authorization');
          if (!hasAuth) {
            init.headers = { ...headersRecord, 'Authorization': `Bearer ${token}` };
          }
        }
      }
    }

    return originalFetch.call(this, input, init);
  };

  try {
    const desc = Object.getOwnPropertyDescriptor(window, 'fetch');
    if (desc && !desc.configurable && !desc.writable) {
      // In environments (such as sandboxed iframes) where window.fetch is a locked/non-configurable
      // getter property, do not attempt to overwrite it. Session cookies handle authentication.
      return;
    }

    Object.defineProperty(window, 'fetch', {
      value: authFetch,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  } catch (err) {
    // If window.fetch cannot be redefined (e.g. read-only getter in sandboxed iframe),
    // safely ignore and rely on standard cookie-based authentication.
    // NEVER attempt direct assignment `window.fetch = ...` because that triggers:
    // "TypeError: Cannot set property fetch of #<Window> which has only a getter"
    console.warn('[AUTH] window.fetch could not be redefined with auth interceptor:', err);
  }
}

// Initialize immediately upon module import
initAuthFetchInterceptor();
