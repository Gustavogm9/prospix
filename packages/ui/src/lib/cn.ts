import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combina classNames condicionalmente + resolve conflitos Tailwind.
 * Usado em todo componente shadcn.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
