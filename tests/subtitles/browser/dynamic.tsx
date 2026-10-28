import React, { Suspense, lazy, type ComponentType } from 'react';

/** Stand-in for next/dynamic in the Vite harness: the loader runs lazily and `loading` shows meanwhile. */
export default function dynamic<P extends object>(load: () => Promise<{ default: ComponentType<P> }>, options: { loading?: () => React.ReactNode } = {}) {
  const Lazy = lazy(load);
  return function Dynamic(props: P) {
    return <Suspense fallback={options.loading?.() ?? null}><Lazy {...props} /></Suspense>;
  };
}
