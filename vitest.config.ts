import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@deepseek-ai/dsh-client-ui-primitives': new URL('./tests/primitives.tsx', import.meta.url).pathname } },
  test: { include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'], environment: 'node' },
})
