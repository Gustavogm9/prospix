import * as React from 'react';
import { cn } from '../lib/cn.js';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  sunken?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, sunken = false, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'rounded border bg-surface p-5 text-text shadow-sm',
          sunken ? 'border-border-subtle bg-surface-sunken shadow-none' : 'border-border-subtle shadow-sm',
          className
        )}
        {...props}
      />
    );
  }
);
Card.displayName = 'Card';

export const CardHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1.5 pb-4 border-b border-border-subtle mb-4', className)} {...props} />
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn('text-md font-semibold tracking-tight text-text leading-none', className)} {...props} />
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = ({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn('text-xs text-text-muted', className)} {...props} />
);
CardDescription.displayName = 'CardDescription';

export const CardContent = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('text-sm', className)} {...props} />
);
CardContent.displayName = 'CardContent';

export const CardFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex items-center pt-4 border-t border-border-subtle mt-4', className)} {...props} />
);
CardFooter.displayName = 'CardFooter';
