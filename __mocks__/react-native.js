const React = require('react');

const Modal = ({ children, visible, onRequestClose, ...props }) => {
  if (!visible) return null;
  return React.createElement('Modal', { ...props, onRequestClose }, children);
};

const View = ({ children, ...props }) => {
  return React.createElement('View', props, children);
};

const Text = ({ children, ...props }) => {
  return React.createElement('Text', props, children);
};

const TouchableOpacity = ({ children, onPress, ...props }) => {
  return React.createElement('TouchableOpacity', { ...props, onPress }, children);
};

const StyleSheet = {
  create: (styles) => styles,
  flatten: (style) => {
    if (Array.isArray(style)) {
      return Object.assign({}, ...style);
    }
    return style || {};
  },
};

const Platform = {
  OS: 'ios',
  select: (obj) => obj.ios || obj.default,
};

module.exports = {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
};
