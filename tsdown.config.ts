import { readFileSync } from 'node:fs'
import type { UserConfig } from 'tsdown'

const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { name: string }

export default [
  {
    entry: { index: 'src/index.ts' }, outDir: 'lib', format: 'esm',
    platform: 'node', target: 'es2024', dts: true, clean: true, fixedExtension: false,
    deps: { neverBundle: [/^@deepseek-ai\//, /^@earendil-works\//] },
  },
  {
    entry: { client: 'src/client/index.tsx' }, outDir: 'lib', format: 'cjs',
    platform: 'browser', dts: false, clean: false,
    deps: { neverBundle: ['react', 'react/jsx-runtime', /^@deepseek-ai\//] },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
] satisfies UserConfig[]
