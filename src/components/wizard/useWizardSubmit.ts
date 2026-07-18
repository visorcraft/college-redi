import { useEffect, type MutableRefObject } from 'react';

export type WizardSubmitRef = MutableRefObject<(() => void) | null>;

// ponytail: each step exposes its submit fn via this ref; WizardShell renders the unified action row.
export function useWizardSubmit(submitRef: WizardSubmitRef | undefined, fn: () => void) {
  useEffect(() => {
    if (!submitRef) return;
    submitRef.current = fn;
    return () => {
      if (submitRef.current === fn) submitRef.current = null;
    };
  }, [submitRef, fn]);
}
