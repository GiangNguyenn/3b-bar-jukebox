require('@testing-library/jest-dom');

const React = require('react');

// Mock React.useState and other hooks
global.React = React;

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