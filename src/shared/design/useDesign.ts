import { useEffect } from 'react';
import { useSettingsStore } from '@/shared/store/settingsStore';
import { applyDesign, nextDesign, type DesignId } from '@/shared/design/designs';
import { trackEvent } from '@/shared/lib/analytics';

/** The active design. Subscribing makes a component re-render on a switch —
 * needed only where the design is read in JS (inline styles), not for the
 * CSS-variable tokens, which repaint on their own. */
export function useDesign(): DesignId {
  return useSettingsStore((s) => s.design);
}

/** Non-reactive read for plain helpers (see shared/lib/tier.ts). */
export function getDesign(): DesignId {
  return useSettingsStore.getState().design;
}

/** Keeps <html data-design> in sync with the store. Mounted once, in App. */
export function useDesignSync(): void {
  const design = useDesign();
  useEffect(() => { applyDesign(design); }, [design]);
}

/** State + action for the switcher button. */
export function useDesignSwitcher() {
  const design = useDesign();
  const setDesign = useSettingsStore((s) => s.setDesign);
  return {
    design,
    next: nextDesign(design),
    toggle: () => {
      const to = nextDesign(design);
      setDesign(to);
      trackEvent('design_switched', { design: to });
    },
  };
}
