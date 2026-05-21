import * as React from 'react';
import { cn } from '../lib/cn.js';

export interface ToastMessage {
  id: string;
  type: 'success' | 'warning' | 'error' | 'info';
  title: string;
  description?: string;
  duration?: number;
}

export type ToastType = ToastMessage['type'];

let listeners: Array<(toasts: ToastMessage[]) => void> = [];
let toasts: ToastMessage[] = [];

export const toast = {
  show: (type: ToastType, title: string, description?: string, duration = 4000) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: ToastMessage = { id, type, title, description, duration };
    toasts = [...toasts, newToast];
    listeners.forEach((listener) => listener(toasts));

    if (duration > 0) {
      setTimeout(() => {
        toast.dismiss(id);
      }, duration);
    }
    return id;
  },
  success: (title: string, description?: string, duration = 4000) => {
    return toast.show('success', title, description, duration);
  },
  error: (title: string, description?: string, duration = 6000) => {
    return toast.show('error', title, description, duration);
  },
  warning: (title: string, description?: string, duration = 4500) => {
    return toast.show('warning', title, description, duration);
  },
  info: (title: string, description?: string, duration = 4000) => {
    return toast.show('info', title, description, duration);
  },
  dismiss: (id: string) => {
    toasts = toasts.filter((t) => t.id !== id);
    listeners.forEach((listener) => listener(toasts));
  },
  subscribe: (listener: (toasts: ToastMessage[]) => void) => {
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  },
};

export const ToastContainer = () => {
  const [activeToasts, setActiveToasts] = React.useState<ToastMessage[]>([]);

  React.useEffect(() => {
    return toast.subscribe(setActiveToasts);
  }, []);

  if (activeToasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-full max-w-sm pointer-events-none">
      {activeToasts.map((t) => {
        const borderColors = {
          success: 'border-success bg-success-soft text-success-text',
          warning: 'border-warning bg-warning-soft text-warning-text',
          error: 'border-error bg-error-soft text-error-text',
          info: 'border-primary bg-primary-soft text-primary',
        };

        const icons = {
          success: (
            <svg className="h-5 w-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ),
          warning: (
            <svg className="h-5 w-5 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ),
          error: (
            <svg className="h-5 w-5 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ),
          info: (
            <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
        };

        return (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded border p-4 shadow-lg animate-in slide-in-from-bottom duration-200 bg-surface',
              borderColors[t.type]
            )}
            role="alert"
          >
            <div className="flex-shrink-0 mt-0.5">{icons[t.type]}</div>
            <div className="flex-1">
              <h4 className="text-sm font-semibold leading-tight">{t.title}</h4>
              {t.description && <p className="text-2xs opacity-90 mt-1">{t.description}</p>}
            </div>
            <button
              onClick={() => toast.dismiss(t.id)}
              className="flex-shrink-0 opacity-75 hover:opacity-100 transition-opacity"
              aria-label="Fechar notificação"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
};
