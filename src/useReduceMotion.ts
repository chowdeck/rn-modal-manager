import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * The OS "Reduce Motion" setting, through React Native's `AccessibilityInfo`.
 * Starts false and updates once the setting is read.
 */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(function trackReduceMotion() {
    let active = true;
    AccessibilityInfo?.isReduceMotionEnabled?.()
      .then(enabled => {
        if (active) setReduceMotion(!!enabled);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo?.addEventListener?.(
      'reduceMotionChanged',
      (enabled: boolean) => setReduceMotion(!!enabled)
    );
    return () => {
      active = false;
      subscription?.remove?.();
    };
  }, []);

  return reduceMotion;
}

export default useReduceMotion;
