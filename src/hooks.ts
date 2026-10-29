import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import modalController from './modalController';
import type { ModalHandle, ModalRef, ModalView } from './types';

export const modalIdOf = (modal: ModalRef): string | null =>
  typeof modal === 'string' ? modal : modal?.id || null;

/** Read-only view of a modal's state: `{ phase, isOpen, isShown, mounted, params }`. */
export function useModalView<P = unknown>(modal: ModalRef): ModalView<P> {
  const id = modalIdOf(modal);
  return useSyncExternalStore(
    modalController.subscribe,
    () => modalController.getView(id) as ModalView<P>
  );
}

/**
 * Handle for a modal by id: its state plus `open(params)`, `close({ then })` and
 * `replaceWith(id, params)`. The handle is what a sheet binds to (`<Sheet
 * modal={handle}>`) and what a screen passes down instead of `isVisible` + `onClose`.
 *
 * `closeModal` / `name` are aliases so host-rendered modal components share one
 * contract (`{ modal: { params, closeModal } }`).
 */
export function useModal<P = unknown>(modal: ModalRef): ModalHandle<P> {
  const id = modalIdOf(modal) || '';
  const view = useModalView<P>(id);
  return useMemo<ModalHandle<P>>(
    () => ({
      id,
      name: view.baseId || id,
      phase: view.phase,
      isOpen: view.isOpen,
      isShown: view.isShown,
      mounted: view.mounted,
      params: view.params,
      open: (params, options) => modalController.open(id, params, options),
      close: options => modalController.close(id, options),
      closeModal: options => modalController.close(id, options),
      replaceWith: (toId, params, options) =>
        modalController.replace(id, toId, params, options),
    }),
    [id, view]
  );
}

/**
 * A modal that belongs to this component: gets an id of its own (`baseId#n`) for
 * the component's lifetime, so the same sheet can exist on several screens or once
 * per list item. Use for every screen-local sheet, picker or popup.
 */
export function useModalInstance<P = unknown>(baseId: string): ModalHandle<P> {
  const [id] = useState(() => modalController.createInstance(baseId));
  useEffect(() => () => modalController.remove(id), [id]);
  return useModal<P>(id);
}

/** Every view in the store, for the host. */
export function useModalViews(): ReadonlyMap<string, ModalView> {
  return useSyncExternalStore(
    modalController.subscribe,
    modalController.getSnapshot
  );
}
