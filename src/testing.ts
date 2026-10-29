import modalController from './modalController';

/**
 * Helpers for consumers' Jest setups.
 *
 * Most app tests don't care about presentation order: put the controller in
 * pass-through mode (the server kill switch) so every open/close is honoured at
 * once, as plain React Native `visible` would be.
 *
 * ```js
 * // jest.setup.js
 * import { testing } from 'rn-modal-manager';
 * beforeEach(() => testing.reset({ passThrough: true }));
 * ```
 *
 * Tests of sequencing keep the controller enabled, use fake timers, and drive the
 * native callbacks (`onShow` / `onDismiss` of the rendered React Native `Modal`) or
 * call `testing.completeTransitions()`.
 */
export const testing = {
  /** Kill switch on: no serialisation, gating or watchdogs. */
  enablePassThrough(): void {
    modalController.setPolicy({ enabled: false });
  },

  /**
   * Clears every entry, timer, signal, listener, the server policy and the reporter
   * (`modalController.__reset()`). Configured policies and signals are kept;
   * `appReady` overrides the configured value when given.
   */
  reset({
    passThrough = false,
    appReady,
  }: { passThrough?: boolean; appReady?: boolean } = {}): void {
    modalController.__reset();
    if (appReady !== undefined) modalController.setSignals({ appReady });
    if (passThrough) testing.enablePassThrough();
  },

  /**
   * Completes every native transition in flight as if the platform reported it
   * (`onShow`, the exit animation, `onDismiss`), until nothing is moving. Returns
   * the number of transitions completed.
   */
  completeTransitions(maxSteps = 100): number {
    let steps = 0;
    while (steps < maxSteps) {
      const moving = modalController
        .inspect()
        .entries.find(
          entry =>
            entry.phase === 'presenting' ||
            entry.phase === 'exiting' ||
            entry.phase === 'dismissing'
        );
      if (!moving) break;
      if (moving.phase === 'presenting') modalController.notifyShown(moving.id);
      else if (moving.phase === 'exiting')
        modalController.notifyExited(moving.id);
      else modalController.notifyDismissed(moving.id);
      steps += 1;
    }
    return steps;
  },
};

export default testing;
