import js from '@eslint/js'
import globals from 'globals'

export default [
  {
    ignores: ['dist/**', 'lib/**', 'coverage/**']
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      // The empty catch in utils.js (parseTags) is intentional.
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
]
