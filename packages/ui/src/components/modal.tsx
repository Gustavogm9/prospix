import * as React from 'react';
import { cn } from '../lib/cn.js';
import { Button } from './button.js';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: ModalProps) => {
  const modalRef = React.useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = React.useState(isOpen);
  const [isAnimating, setIsAnimating] = React.useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsAnimating(true);
    } else if (shouldRender) {
      setIsAnimating(false);
      const timer = setTimeout(() => {
        setShouldRender(false);
      }, 200); // matches duration-200
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !modalRef.current) return;

      const focusableElements = modalRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0] as HTMLElement;
      const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          lastElement.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastElement) {
          firstElement.focus();
          e.preventDefault();
        }
      }
    };

    const previousActiveElement = document.activeElement as HTMLElement;

    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleEscape);
      window.addEventListener('keydown', handleTab);
      // Focus first element or modal wrapper
      setTimeout(() => {
        if (modalRef.current) {
          const focusable = modalRef.current.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (focusable.length > 0) {
            (focusable[0] as HTMLElement).focus();
          } else {
            modalRef.current.focus();
          }
        }
      }, 50);
    }

    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('keydown', handleTab);
      if (previousActiveElement) {
        previousActiveElement.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!shouldRender) return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
  };

  const backdropClass = isAnimating
    ? 'animate-in fade-in duration-200 bg-black/40 backdrop-blur-sm'
    : 'animate-out fade-out duration-200 bg-black/0 backdrop-blur-none';

  const animationClass = isAnimating
    ? 'animate-in fade-in zoom-in-95 duration-200'
    : 'animate-out fade-out zoom-out-95 duration-200';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className={cn("fixed inset-0 transition-all", backdropClass)} onClick={onClose} />

      {/* Modal Box */}
      <div
        ref={modalRef}
        tabIndex={-1}
        className={cn(
          'relative w-full rounded-lg bg-surface shadow-lg border border-border-subtle flex flex-col max-h-[85vh] focus:outline-none',
          animationClass,
          sizeClasses[size]
        )}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle p-4">
          <h3 className="text-md font-semibold text-text">{title}</h3>
          <Button variant="ghost" size="compact" onClick={onClose} aria-label="Fechar modal">
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto text-sm text-text-secondary flex-1">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border-subtle bg-surface-sunken/40 p-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
