import { useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { headerTitleOverrideAtom } from '../store/navigation.js';

/**
 * Sets the header bar title for the duration of the calling component's
 * lifecycle. Clears the override on unmount so the header falls back to
 * the menu-derived title.
 */
export function useHeaderTitle(title: string): void {
  const setOverride = useSetAtom(headerTitleOverrideAtom);

  useEffect(() => {
    setOverride(title);
    return () => setOverride(null);
  }, [title, setOverride]);
}
