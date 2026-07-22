export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Scopes we expect across the monorepo (advisory, not enforced-exhaustive).
    'scope-enum': [
      1,
      'always',
      [
        'shared',
        'capture',
        'compositor',
        'encoder',
        'timeline',
        'overlay',
        'ui',
        'desktop',
        'server',
        'record',
        'meet',
        'studio',
        'editor',
        'shell',
        'e2e',
        'ci',
        'docs',
        'deps',
      ],
    ],
  },
};
