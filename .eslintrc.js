module.exports = {
  extends: [
    'next/core-web-vitals',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    // Allow implicit return types where TypeScript can infer them
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    // Allow optional chaining in cases where it might be safer
    '@typescript-eslint/no-unnecessary-condition': 'off',
    // Prefer using the nullish coalescing operator
    '@typescript-eslint/prefer-nullish-coalescing': 'warn',
    // Keep strict type safety for assignments
    '@typescript-eslint/no-unsafe-assignment': 'error',
    // Allow optional chaining for better null safety
    '@typescript-eslint/prefer-optional-chain': 'warn',
  },
}; 