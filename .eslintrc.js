module.exports = {
  ignorePatterns: [
    '.eslintrc.js',
    'next.config.mjs',
    'postcss.config.mjs',
    'tailwind.config.ts',
    'instrumentation.ts',
    'instrumentation-client.ts',
    'node_modules/',
    'public/',
    'prisma/'
  ],
  overrides: [
    {
      files: ['*.ts', '*.tsx'],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        project: './tsconfig.json'
      },
      plugins: ['@typescript-eslint', 'unused-imports'],
      extends: [
        'plugin:@typescript-eslint/recommended',
        'plugin:@typescript-eslint/recommended-requiring-type-checking'
      ],
      rules: {
        'unused-imports/no-unused-imports': 'error',
        'unused-imports/no-unused-vars': [
          'warn',
          {
            vars: 'all',
            varsIgnorePattern: '^_',
            args: 'after-used',
            argsIgnorePattern: '^_'
          }
        ]
      }
    },
    {
      files: ['hooks/ConsoleLogsProvider.tsx', 'shared/utils/logger.ts'],
      rules: {
        'no-console': 'off',
        'no-restricted-syntax': 'off'
      }
    }
  ],

  extends: [
    'next/core-web-vitals',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking'
  ],
  rules: {
    // Allow implicit return types where TypeScript can infer them
    '@typescript-eslint/explicit-function-return-type': 'warn',
    '@typescript-eslint/explicit-module-boundary-types': 'error',
    // Allow optional chaining in cases where it might be safer
    // Prefer using the nullish coalescing operator
    '@typescript-eslint/prefer-nullish-coalescing': 'warn',
    // Keep strict type safety for assignments
    '@typescript-eslint/no-unsafe-assignment': 'error',
    // Allow optional chaining for better null safety
    '@typescript-eslint/prefer-optional-chain': 'warn',
    '@typescript-eslint/no-unused-expressions': 'error',
    '@typescript-eslint/dot-notation': ['error', { allowKeywords: true }],
    '@typescript-eslint/no-empty-function': [
      'error',
      { allow: ['arrowFunctions'] }
    ],
    'unused-imports/no-unused-vars': [
      'warn',
      {
        vars: 'all',
        varsIgnorePattern: '^_',
        args: 'after-used',
        argsIgnorePattern: '^_'
      }
    ],
    // Enforce centralized logging system
    'no-console': [
      'error',
      {
        allow: ['warn', 'error']
      }
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector:
          "CallExpression[callee.object.name='console'][callee.property.name='log']",
        message:
          'Use the centralized logging system instead of console.log. For React components: import useConsoleLogsContext and use addLog(). For other files: import createModuleLogger from @/shared/utils/logger.'
      },
      {
        selector:
          "CallExpression[callee.object.name='console'][callee.property.name='info']",
        message:
          "Use the centralized logging system instead of console.info. For React components: import useConsoleLogsContext and use addLog('INFO', ...). For other files: import createModuleLogger from @/shared/utils/logger."
      }
    ]
  }
}
