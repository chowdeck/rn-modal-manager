// Jest setup file
// Configure the test environment for React concurrent features
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// React Native defines __DEV__; the controller's dev-only checks read it.
globalThis.__DEV__ = true;

// The react-native mock is in __mocks__/react-native.js
