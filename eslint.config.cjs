const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', 'app/**', 'runtime/**', 'logs/**']
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'scripts/**/*.js', 'development.js', 'production.js', 'bootstrap.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: {
        ...globals.node,
        think: 'readonly'
      }
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': 'off',
      'no-unreachable': 'off',
      'no-extra-semi': 'off',
      'no-undef': 'off',
      'no-redeclare': 'off',
      'no-empty': 'off',
      'no-useless-escape': 'off',
      'no-control-regex': 'off'
    }
  },
  {
    files: ['src/common/config/node-crontab.js'],
    languageOptions: {
      sourceType: 'module'
    }
  }
];
