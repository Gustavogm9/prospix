import * as React from 'react';
import { cn } from '../lib/cn.js';

export const Skeleton = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn('animate-pulse rounded bg-border-strong/50', className)}
      {...props}
    />
  );
};

Skeleton.displayName = 'Skeleton';
