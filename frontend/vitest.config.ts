import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      // e2e/ holds Playwright specs, which Vitest's default `*.spec.ts` pattern would otherwise pick up.
      exclude: [...configDefaults.exclude, 'e2e/**'],
    },
  }),
)
