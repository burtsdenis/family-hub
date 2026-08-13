// The linter is scoped narrowly and deliberately: the recommended TypeScript
// set plus react-hooks — unstable hook identities have already caused silent
// request loops, the project's main trap. Style is held by TypeScript itself
// and code review; there are no taste rules here.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // "Load on mount and put into state" is this app's primary way of
      // fetching data; the rule flags every such place. The real trap
      // (loops from unstable dependencies) is caught by exhaustive-deps —
      // which stays an error.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    rules: {
      // An empty catch is a deliberate project pattern ("no localStorage —
      // fine"), but an unused error variable is litter
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
);
