// import baseConfig from '../../eslint.config.mjs';

// export default [
//   ...baseConfig,
//   {
//     ignores: ['tsup.config.ts', '**/*.test.ts', '**/*.spec.ts', '**/__tests__/**', 'tests/**'],
//   },
//   {
//     rules: {
//       // Enforce clean import paths
//       'import/no-absolute-path': 'error',
//       'import/no-useless-path-segments': ['error', { noUselessIndex: true }],
//       'import/no-duplicates': 'error',
//       'import/first': 'error',
//       'import/newline-after-import': 'warn',
//       'import/order': [
//         'warn',
//         {
//           groups: [
//             'builtin', // Node.js built-in modules
//             'external', // npm packages
//             'internal', // @/ imports
//             'parent', // ../ imports
//             'sibling', // ./ imports
//             'index', // ./index
//             'type', // type imports
//           ],
//           'newlines-between': 'always',
//           alphabetize: { order: 'asc', caseInsensitive: true },
//           pathGroups: [
//             {
//               pattern: '@/**',
//               group: 'internal',
//               position: 'before',
//             },
//             {
//               pattern: '@tests/**',
//               group: 'internal',
//               position: 'after',
//             },
//           ],
//           pathGroupsExcludedImportTypes: ['builtin', 'type'],
//         },
//       ],
//     },
//   },
//   {
//     files: ['src/**/*.ts'],
//     ignores: [
//       // Barrel files that re-export from submodules should use relative paths
//       'src/index.ts',
//       'src/grasshopper.ts',
//       'src/threejs.ts',
//       'src/core/index.ts',
//       'src/types/index.ts',
//     ],
//     rules: {
//       'no-restricted-imports': [
//         'error',
//         {
//           patterns: [
//             // Prevent old bare imports without @/ prefix (these match literal strings only)
//             {
//               group: ['core', 'core/**', '!@/**'],
//               message: 'Use @/core/* for cross-module imports (with @ prefix)',
//             },
//             {
//               group: ['features', 'features/**', '!@/**'],
//               message: 'Use @/features/* for cross-module imports (with @ prefix)',
//             },
//             {
//               group: ['grasshopper', 'grasshopper/**', '!@/**'],
//               message: 'Use @/features/grasshopper/* or relative paths within feature',
//             },
//             // Prevent deep relative paths that cross module boundaries
//             {
//               group: ['../**/core', '../../**/core', '../../../**/core'],
//               message: 'Use @/core/* for core imports instead of deep relative paths',
//             },
//             {
//               group: ['../**/features', '../../**/features'],
//               message: 'Use @/features/* instead of deep relative paths',
//             },
//           ],
//         },
//       ],
//     },
//   },
// ];
