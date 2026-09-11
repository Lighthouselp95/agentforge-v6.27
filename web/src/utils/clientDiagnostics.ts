/**
 * Client Diagnostics & Error Collector for AgentForge
 * Traps runtime errors, unhandled promise rejections, and React boundary crashes
 * Reports them defensively to /api/debug/client-log for AI investigation
 */

let errorBurstCount = 0;
let isReporting = false;

// Reset rate-limit counter every 10 seconds
setInterval(() => {
  errorBurstCount = 0;
}, 10000);

export function reportClientError(
  type: string,
  message: string,
  stack?: string,
  details?: Record<string, any>
) {
  // Rate limiting to prevent flooding
  if (errorBurstCount >= 8 || isReporting) return;
  errorBurstCount++;
  isReporting = true;

  try {
    const payload = {
      type: String(type || 'client_error').slice(0, 50),
      message: String(message || 'Unknown error').slice(0, 2000),
      stack: stack ? String(stack).slice(0, 4000) : undefined,
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: Date.now(),
      details: details ? details : undefined,
    };

    fetch('/api/debug/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .catch(() => {})
      .finally(() => {
        isReporting = false;
      });
  } catch {
    isReporting = false;
  }
}

export function initClientDiagnostics() {
  if (typeof window === 'undefined') return;

  // Window error handler
  window.addEventListener('error', (event: ErrorEvent) => {
    reportClientError(
      'uncaught_error',
      event.message || 'Uncaught window error',
      event.error?.stack,
      {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      }
    );
  });

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const msg = reason instanceof Error ? reason.message : String(reason || 'Unhandled promise rejection');
    const stack = reason instanceof Error ? reason.stack : undefined;
    reportClientError('unhandled_rejection', msg, stack);
  });

  // Optional: Hook console.error defensively
  const originalConsoleError = console.error;
  console.error = function (...args: any[]) {
    originalConsoleError.apply(console, args);
    try {
      const firstArg = args[0];
      const errMsg =
        typeof firstArg === 'string'
          ? firstArg
          : firstArg instanceof Error
          ? firstArg.message
          : JSON.stringify(firstArg);
      
      // Only report serious console errors, ignore dev noise
      if (
        typeof errMsg === 'string' &&
        !errMsg.includes('Download the React DevTools') &&
        !errMsg.includes('favicon.ico') &&
        !errMsg.includes('/api/debug/client-log')
      ) {
        reportClientError('console_error', errMsg.slice(0, 500));
      }
    } catch {}
  };
}
