import * as React from 'react';
import { cn } from '../lib/cn.js';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, ...props }, ref) => {
    return (
      <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-text-secondary">
        <input
          type="checkbox"
          className={cn(
            'h-4 w-4 rounded border-border-strong text-primary bg-surface-sunken focus:ring-primary focus:ring-offset-0 transition-colors',
            className
          )}
          ref={ref}
          {...props}
        />
        {label && <span>{label}</span>}
      </label>
    );
  }
);
Checkbox.displayName = 'Checkbox';
