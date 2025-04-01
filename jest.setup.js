require('@testing-library/jest-dom');

const React = require('react');

// Mock React.useState and other hooks
global.React = React;

// Mock React hooks
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: jest.fn(),
  useEffect: jest.fn(),
  useContext: jest.fn(),
})); 