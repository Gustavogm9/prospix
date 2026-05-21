import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn.js';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded font-sans font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-white hover:bg-primary-hover shadow-sm focus-visible:ring-primary/50',
        secondary: 'bg-secondary text-white hover:opacity-90 shadow-sm focus-visible:ring-secondary/50',
        ghost: 'text-text-secondary hover:bg-surface-sunken hover:text-text focus-visible:ring-border-strong',
        outline: 'bg-surface text-text border border-border-strong hover:bg-surface-sunken focus-visible:ring-border-strong',
        danger: 'bg-error text-white hover:opacity-95 shadow-sm focus-visible:ring-error/50',
      },
      size: {
        compact: 'h-7 px-3 text-xs gap-1.5',
        default: 'h-9 px-4 text-sm gap-2',
        large: 'h-12 px-6 text-md gap-2.5',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';
