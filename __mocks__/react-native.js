const React = require('react');

// Like the native component, renders its children only while visible. `onShow` and
// `onDismiss` are passed through as props so tests can fire them.
const Modal = ({ children, visible, ...props }) => {
  if (!visible) return null;
  return React.createElement('Modal', props, children);
};

const host = name => {
  const Component = ({ children, ...props }) =>
    React.createElement(name, props, children);
  Component.displayName = name;
  return Component;
};

const View = host('View');
const Text = host('Text');
const TouchableOpacity = host('TouchableOpacity');
const TouchableWithoutFeedback = ({ children }) => children;

const StyleSheet = {
  create: styles => styles,
  flatten: style => {
    if (Array.isArray(style)) {
      return Object.assign({}, ...style);
    }
    return style || {};
  },
  absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  absoluteFillObject: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
};

const Platform = {
  OS: 'ios',
  select: obj => obj.ios || obj.default,
};

class AnimatedValue {
  constructor(value) {
    this.value = value;
  }
  setValue(value) {
    this.value = value;
  }
  interpolate(config) {
    return { interpolation: config, source: this };
  }
}

// Timing animations complete after their duration, on (fake) timers.
const Animated = {
  Value: AnimatedValue,
  View: host('Animated.View'),
  timing: (value, config) => ({
    start: callback => {
      setTimeout(() => {
        value.setValue(config.toValue);
        if (callback) callback({ finished: true });
      }, config.duration || 0);
    },
    stop: () => {},
  }),
};

const Easing = {
  bezier: () => t => t,
  linear: t => t,
};

const Dimensions = {
  get: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
};

const AccessibilityInfo = {
  isReduceMotionEnabled: jest.fn(() => Promise.resolve(false)),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
};

module.exports = {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
  Platform,
  Animated,
  Easing,
  Dimensions,
  AccessibilityInfo,
};
