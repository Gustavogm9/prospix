'use client';

import { ToastContainer } from '@prospix/ui';

/**
 * Client-side wrapper for ToastContainer.
 * Used in the root layout (server component) to render toasts globally.
 */
export function GlobalToast() {
  return <ToastContainer />;
}
