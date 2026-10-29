import {
  useEffect,
  useMemo,
  useRef,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  StyleSheet,
  TouchableWithoutFeedback,
  View,
  type ColorValue,
  type EasingFunction,
} from 'react-native';
import Modal from './Modal';
import modalController from './modalController';
import { useModal, useModalViews } from './hooks';
import { useReduceMotion } from './useReduceMotion';
import type {
  ModalComponentProps,
  ModalPreset,
  ModalRegistry,
  ModalRegistryEntry,
} from './types';

/** Animation of the preset shells (`bottom` / `screen` / `center`). */
export interface ModalMotion {
  /** Entrance of `bottom` and `screen` presets (slide up). */
  sheetInMs: number;
  /** Entrance of the `center` preset (fade + scale). */
  centerInMs: number;
  /** Exit of every preset; also the `exitMs` the shell declares. */
  exitMs: number;
  /** Entrance and exit when reduce-motion is on (fade only). */
  reducedMs: number;
  easing: EasingFunction;
  /** Scale the `center` preset starts from. */
  centerScaleFrom: number;
  backdropOpacity: number;
  backdropColor: ColorValue;
}

// Strong ease-out: fast start, soft settle. Built on first use.
let strongEaseOut: EasingFunction | null = null;
const defaultEasing: EasingFunction = t => {
  if (!strongEaseOut) strongEaseOut = Easing.bezier(0.23, 1, 0.32, 1);
  return strongEaseOut(t);
};

export const DEFAULT_MODAL_MOTION: Readonly<ModalMotion> = Object.freeze({
  sheetInMs: 340,
  centerInMs: 280,
  exitMs: 220,
  reducedMs: 180,
  easing: defaultEasing,
  centerScaleFrom: 0.95,
  backdropOpacity: 0.6,
  backdropColor: 'black',
});

const PRESETS: Record<
  ModalPreset,
  {
    justifyContent: 'flex-end' | 'center';
    motion: 'slide' | 'scale';
    inMs: 'sheetInMs' | 'centerInMs';
  }
> = {
  bottom: { justifyContent: 'flex-end', motion: 'slide', inMs: 'sheetInMs' },
  screen: { justifyContent: 'center', motion: 'slide', inMs: 'sheetInMs' },
  center: { justifyContent: 'center', motion: 'scale', inMs: 'centerInMs' },
};

type HostedComponent = ComponentType<ModalComponentProps<unknown>>;

interface ShellProps {
  id: string;
  preset: ModalPreset | undefined;
  Component: HostedComponent;
  motion: ModalMotion;
  reduceMotion: boolean;
  children?: ReactNode;
}

function PresetShell({
  id,
  preset,
  Component,
  motion,
  reduceMotion,
  children,
}: ShellProps) {
  const modal = useModal(id);
  const progress = useRef(new Animated.Value(0)).current;
  const config = PRESETS[preset || 'bottom'] || PRESETS.bottom;
  const exitMs = reduceMotion ? motion.reducedMs : motion.exitMs;

  useEffect(
    function animateOnPhase() {
      if (modal.phase === 'shown') {
        Animated.timing(progress, {
          toValue: 1,
          duration: reduceMotion ? motion.reducedMs : motion[config.inMs],
          easing: motion.easing,
          useNativeDriver: true,
        }).start();
      } else if (modal.phase === 'exiting') {
        Animated.timing(progress, {
          toValue: 0,
          duration: exitMs,
          easing: motion.easing,
          useNativeDriver: true,
        }).start(() => modalController.notifyExited(id));
      } else if (modal.phase === 'idle') {
        progress.setValue(0);
      }
    },
    // Only phase changes animate; motion settings apply from the next one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modal.phase]
  );

  // Back button and backdrop close this modal only.
  const close = () => modal.close({ reason: 'backdrop' });
  const height = Dimensions.get('screen').height;
  let transform;
  if (!reduceMotion) {
    transform =
      config.motion === 'scale'
        ? [
            {
              scale: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [motion.centerScaleFrom, 1],
              }),
            },
          ]
        : [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [height, 0],
              }),
            },
          ];
  }

  return (
    <Modal
      modal={id}
      transparent
      exitMs={exitMs}
      keepIntentOnUnmount
      onRequestClose={close}
    >
      <View style={styles.fill}>
        <TouchableWithoutFeedback onPress={close}>
          <Animated.View
            style={[
              styles.backdrop,
              {
                backgroundColor: motion.backdropColor,
                opacity: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, motion.backdropOpacity],
                }),
              },
            ]}
          />
        </TouchableWithoutFeedback>
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.container,
            {
              justifyContent: config.justifyContent,
              opacity: progress,
              transform,
            },
          ]}
        >
          <Component modal={modal} params={modal.params} />
        </Animated.View>
        {children}
      </View>
    </Modal>
  );
}

// Registry entries may declare `component` or a lazy `load` (resolved once).
const loaded = new WeakMap<ModalRegistryEntry, HostedComponent>();
const componentOf = (definition: ModalRegistryEntry): HostedComponent => {
  if ('component' in definition) return definition.component as HostedComponent;
  let component = loaded.get(definition);
  if (!component) {
    component = definition.load() as HostedComponent;
    loaded.set(definition, component);
  }
  return component;
};

function OwnSheet({
  id,
  Component,
}: {
  id: string;
  Component: HostedComponent;
}) {
  const modal = useModal(id);
  return <Component modal={modal} params={modal.params} />;
}

interface ChainProps {
  ids: string[];
  index: number;
  registry: ModalRegistry;
  motion: ModalMotion;
  reduceMotion: boolean;
}

function StackChain({
  ids,
  index,
  registry,
  motion,
  reduceMotion,
}: ChainProps) {
  const id = ids[index];
  if (!id) return null;
  return (
    <PresetShell
      key={id}
      id={id}
      preset={registry[id].preset}
      Component={componentOf(registry[id])}
      motion={motion}
      reduceMotion={reduceMotion}
    >
      <StackChain
        ids={ids}
        index={index + 1}
        registry={registry}
        motion={motion}
        reduceMotion={reduceMotion}
      />
    </PresetShell>
  );
}

export interface ModalHostProps {
  /** Every modal this host may render, by id. */
  registry: ModalRegistry;
  /**
   * Screen parent key (`screenParentKey(route.name)`) for a host inside a native
   * modal screen; null (default) for the app-level host.
   */
  scope?: string | null;
  /** Overrides of the preset shells' animation. */
  motion?: Partial<ModalMotion>;
  /** Overrides the OS reduce-motion setting (read through `AccessibilityInfo`). */
  reduceMotion?: boolean;
}

/**
 * Renders every open registry modal. Preset (stack) modals nest in the order they
 * were opened, so one opened from another presents on top of it; the rest are root
 * siblings and the controller shows them one at a time.
 *
 * The app-level host renders unscoped modals. A native modal screen renders its own
 * host with `scope` (its screen parent key) for the modals the user opened while it
 * was on top, so they present inside that screen; they close when it does.
 */
export function ModalHost({
  registry,
  scope = null,
  motion: motionOverrides,
  reduceMotion: reduceMotionOverride,
}: ModalHostProps) {
  const views = useModalViews();
  const systemReduceMotion = useReduceMotion();
  const reduceMotion = reduceMotionOverride ?? systemReduceMotion;
  const motion = useMemo(
    () => ({ ...DEFAULT_MODAL_MOTION, ...motionOverrides }),
    [motionOverrides]
  );
  const renderedRef = useRef<string[]>([]);
  const { chain, own } = useMemo(() => {
    const mounted = Array.from(views.values()).filter(
      view =>
        view.mounted &&
        view.id &&
        registry[view.id] &&
        (view.hostScope || null) === scope
    );
    const idOf = (view: (typeof mounted)[number]) => view.id as string;
    return {
      chain: mounted
        .filter(view => registry[idOf(view)].preset)
        .sort((a, b) => a.openedAt - b.openedAt)
        .map(idOf),
      own: mounted.filter(view => !registry[idOf(view)].preset).map(idOf),
    };
  }, [views, registry, scope]);

  useEffect(function trackRenderedModals() {
    renderedRef.current = [...own, ...chain];
  });

  useEffect(
    function releaseScopeOnUnmount() {
      // A screen's host going away closes the modals it rendered (stack modals keep
      // their intent when they unmount, see PresetShell) and hands the ones it never
      // rendered back to the app's host.
      return () =>
        modalController.releaseScope(scope, { rendered: renderedRef.current });
    },
    [scope]
  );

  return (
    <>
      {own.map(id => (
        <OwnSheet key={id} id={id} Component={componentOf(registry[id])} />
      ))}
      <StackChain
        ids={chain}
        index={0}
        registry={registry}
        motion={motion}
        reduceMotion={reduceMotion}
      />
    </>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
  },
});

export default ModalHost;
