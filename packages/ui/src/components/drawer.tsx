import * as React from 'react';
import { cn } from '../lib/cn.js';
import { Button } from './button.js';

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'md' | 'lg';
  width?: string | number;
}

export const Drawer = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  width,
}: DrawerProps) => {
  const drawerRef = React.useRef<HTMLDivElement>(null);
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
      }, 300); // matches slide duration
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !drawerRef.current) return;

      const focusableElements = drawerRef.current.querySelectorAll(
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
      
      // Focus first element or drawer wrapper
      setTimeout(() => {
        if (drawerRef.current) {
          const focusable = drawerRef.current.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (focusable.length > 0) {
            (focusable[0] as HTMLElement).focus();
          } else {
            drawerRef.current.focus();
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
    md: 'max-w-[480px]',
    lg: 'max-w-[600px]',
  };

  const backdropClass = isAnimating
    ? 'animate-in fade-in duration-300 bg-black/40 backdrop-blur-sm'
    : 'animate-out fade-out duration-300 bg-black/0 backdrop-blur-none';

  const animationClass = isAnimating
    ? 'animate-in slide-in-from-right duration-300'
    : 'animate-out slide-out-to-right duration-300';

  const widthStyle = width !== undefined
    ? (typeof width === 'number' ? `${width}px` : width)
    : undefined;

  const customStyle = widthStyle ? { width: widthStyle, maxWidth: '100%' } : undefined;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className={cn("fixed inset-0 transition-all", backdropClass)}
        onClick={onClose}
      />

      {/* Drawer box */}
      <div
        ref={drawerRef}
        tabIndex={-1}
        style={customStyle}
        className={cn(
          'relative w-full h-full bg-surface shadow-lg border-l border-border-subtle flex flex-col z-10 focus:outline-none',
          !widthStyle && sizeClasses[size],
          animationClass
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle p-4 sticky top-0 bg-surface z-20">
          <div>
            <h3 className="text-md font-semibold text-text">{title}</h3>
            {subtitle && <p className="text-2xs text-text-muted mt-0.5">{subtitle}</p>}
          </div>
          <Button variant="ghost" size="compact" onClick={onClose} aria-label="Fechar drawer">
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
        <div className="flex-1 overflow-y-auto p-5 text-sm text-text-secondary">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="border-t border-border-subtle bg-surface-sunken/40 p-4 sticky bottom-0 z-20">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
