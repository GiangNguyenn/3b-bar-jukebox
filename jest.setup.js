require('@testing-library/jest-dom');

// Ensure jest is available globally
global.jest = {
  fn: () => {
    const mockFn = (...args) => mockFn.mockImplementation(...args);
    mockFn.mockImplementation = (fn) => {
      mockFn.mock = { calls: [], results: [] };
      return mockFn;
    };
    mockFn.mockReturnValue = (value) => {
      mockFn.mockImplementation(() => value);
      return mockFn;
    };
    mockFn.mockResolvedValue = (value) => {
      mockFn.mockImplementation(() => Promise.resolve(value));
      return mockFn;
    };
    mockFn.mockRejectedValue = (value) => {
      mockFn.mockImplementation(() => Promise.reject(value));
      return mockFn;
    };
    mockFn.mock = { calls: [], results: [] };
    return mockFn;
  },
  mock: (moduleName, factory) => {
    const mockModule = factory();
    jest.moduleRegistry = jest.moduleRegistry || new Map();
    jest.moduleRegistry.set(moduleName, mockModule);
    return mockModule;
  },
  requireActual: (moduleName) => require(moduleName),
  clearAllMocks: () => {},
  resetAllMocks: () => {},
  restoreAllMocks: () => {},
  spyOn: (obj, methodName) => {
    const original = obj[methodName];
    const spy = (...args) => spy.mockImplementation(...args);
    spy.mockImplementation = (fn) => {
      spy.mock = { calls: [], results: [] };
      return spy;
    };
    obj[methodName] = spy;
    spy.mockRestore = () => {
      obj[methodName] = original;
    };
    spy.mock = { calls: [], results: [] };
    return spy;
  },
  moduleRegistry: new Map()
};

const React = require('react');
const ReactDOM = require('react-dom');

// Mock React.useState and other hooks
global.React = React;
global.ReactDOM = ReactDOM;

// Mock React hooks
jest.mock('react', () => {
  const actualReact = jest.requireActual('react');
  return {
    ...actualReact,
    useState: (initialValue) => actualReact.useState(initialValue),
    useEffect: (callback, deps) => actualReact.useEffect(callback, deps),
    useContext: (context) => actualReact.useContext(context),
  };
});

// Mock ReactDOM
jest.mock('react-dom', () => {
  const actualReactDOM = jest.requireActual('react-dom');
  return {
    ...actualReactDOM,
    createRoot: () => ({
      render: jest.fn(),
      unmount: jest.fn(),
    }),
  };
}); 