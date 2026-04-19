import { defineConfig } from 'vitest/config'
import { defineVitestProject } from '@nuxt/test-utils/config'
import { resolve } from 'node:path'

const sharedAlias = {
  '~': resolve(__dirname, 'app'),
}

// Two-project workspace:
//  1. node  — composables and stores; mocks Nuxt auto-imports via setup.ts
//             (no Nuxt vite plugin so mocks are respected)
//  2. nuxt  — component tests; full Nuxt environment via mountSuspended
//
// environmentMatchGlobs was tried first but the Nuxt vite plugin (activated by
// defineVitestConfig) intercepts module resolution globally, causing store tests
// that polyfill Nuxt auto-imports in setup.ts to fail with
// "[nuxt] instance unavailable". The workspace split keeps the two environments
// fully isolated.
export default defineConfig({
  test: {
    projects: [
      // ── Node project: stores + composables ──────────────────────────
      {
        test: {
          name: 'node',
          globals: true,
          environment: 'node',
          setupFiles: ['./tests/setup.ts'],
          include: [
            'tests/composables/**/*.{test,spec}.ts',
            'tests/stores/**/*.{test,spec}.ts',
          ],
        },
        resolve: { alias: sharedAlias },
      },
      // ── Nuxt project: component tests ───────────────────────────────
      await defineVitestProject({
        test: {
          name: 'nuxt',
          globals: true,
          environment: 'nuxt',
          include: ['tests/components/**/*.{test,spec}.ts'],
        },
        resolve: { alias: sharedAlias },
      }),
    ],
  },
})
