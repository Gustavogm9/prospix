'use client';
import { createContext, useContext } from 'react';
import type { OnboardingProgress } from '@/lib/onboarding-progress';
export const OnboardingProgressContext = createContext<{
  progress: OnboardingProgress | null; loading: boolean; error: boolean; refresh: () => Promise<void>;
} | null>(null);
export function useOnboardingProgress() {
  const value = useContext(OnboardingProgressContext);
  if (!value) throw new Error('Onboarding progress provider missing');
  return value;
}
