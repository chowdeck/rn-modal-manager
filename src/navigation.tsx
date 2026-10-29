import type { ReactNode } from 'react';
import { NativeModalScreenLayout } from './Modal';
import { ModalHost, type ModalHostProps } from './ModalHost';
import modalController, { screenParentKey } from './modalController';
import type { ModalRegistry, NavigationChange } from './types';

/**
 * React Navigation is not a dependency: these helpers only rely on the shape of a
 * navigation container ref (`createNavigationContainerRef()` /
 * `useNavigationContainerRef()`).
 */
export interface NavigationRouteLike {
  name: string;
  key?: string;
}

export interface NavigationStateLike {
  index?: number;
  routes: readonly NavigationRouteLike[];
}

export interface NavigationContainerLike {
  getRootState?: () => NavigationStateLike | undefined;
  getCurrentRoute?: () => NavigationRouteLike | undefined;
}

export type NavigationRefLike =
  | NavigationContainerLike
  | { current: NavigationContainerLike | null }
  | null
  | undefined;

/**
 * The root-level routes presented as native modals (`presentation: 'modal' |
 * 'transparentModal'`): a set or list of names, or a predicate.
 */
export type NativeModalRoutes =
  | ReadonlySet<string>
  | readonly string[]
  | ((routeName: string) => boolean);

export interface ModalNavigationOptions {
  nativeModalRoutes?: NativeModalRoutes;
  /** Name of the focused route, when the app already tracks it. */
  routeName?: string;
}

const containerOf = (
  ref: NavigationRefLike
): NavigationContainerLike | null => {
  if (!ref) return null;
  if ('current' in ref) return ref.current;
  return ref;
};

const isNativeModalRoute = (
  routes: NativeModalRoutes | undefined,
  name: string | undefined
): boolean => {
  if (!routes || !name) return false;
  if (typeof routes === 'function') return routes(name);
  if ('has' in routes) return routes.has(name);
  return routes.includes(name);
};

/**
 * What the modal controller needs to know about the navigation state: the focused
 * route's name and key, and the native modal route on top of the root stack (or
 * null).
 */
export function readNavigationState(
  navigationRef: NavigationRefLike,
  { nativeModalRoutes, routeName }: ModalNavigationOptions = {}
): NavigationChange {
  const navigation = containerOf(navigationRef);
  const rootState = navigation?.getRootState?.();
  const topRootRoute =
    rootState?.routes?.[rootState.index ?? rootState.routes.length - 1];
  const currentRoute = navigation?.getCurrentRoute?.();
  return {
    routeName: routeName ?? currentRoute?.name,
    routeKey: currentRoute?.key,
    nativeModalRoute: isNativeModalRoute(nativeModalRoutes, topRootRoute?.name)
      ? topRootRoute?.name || null
      : null,
  };
}

/**
 * Feeds navigation into the controller. Call it from `NavigationContainer`'s
 * `onReady` and `onStateChange`:
 *
 * ```tsx
 * const sync = () => syncModalNavigation(navigationRef, { nativeModalRoutes });
 * <NavigationContainer ref={navigationRef} onReady={sync} onStateChange={sync}>
 * ```
 */
export function syncModalNavigation(
  navigationRef: NavigationRefLike,
  options: ModalNavigationOptions = {}
): void {
  modalController.markNavigationChange(
    readNavigationState(navigationRef, options)
  );
}

export interface NativeModalScreenWithHostProps extends Omit<
  ModalHostProps,
  'scope'
> {
  route?: { name: string } | null;
  children?: ReactNode;
}

/**
 * Layout of a native modal route: its `<Modal>`s nest inside the screen, and the
 * registry modals the user opens while it is on top render in the screen's own host,
 * because a root-level modal cannot present over a native modal.
 */
export function NativeModalScreenWithHost({
  route,
  children,
  ...hostProps
}: NativeModalScreenWithHostProps) {
  return (
    <NativeModalScreenLayout route={route}>
      {children}
      <ModalHost {...hostProps} scope={screenParentKey(route?.name)} />
    </NativeModalScreenLayout>
  );
}

/**
 * A `screenLayout` for the native modal group of a native-stack navigator:
 *
 * ```tsx
 * const NativeModalLayout = createNativeModalScreenLayout(modalRegistry);
 * <Stack.Group screenLayout={NativeModalLayout} screenOptions={{ presentation: 'transparentModal' }}>
 * ```
 */
export function createNativeModalScreenLayout(
  registry: ModalRegistry,
  hostProps: Omit<
    NativeModalScreenWithHostProps,
    'registry' | 'route' | 'children'
  > = {}
) {
  function NativeModalScreenLayoutWithHost({
    route,
    children,
  }: {
    route?: { name: string } | null;
    children?: ReactNode;
  }) {
    return (
      <NativeModalScreenWithHost
        {...hostProps}
        registry={registry}
        route={route}
      >
        {children}
      </NativeModalScreenWithHost>
    );
  }
  return NativeModalScreenLayoutWithHost;
}
