import { defineConfig } from 'tsup'
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

export default defineConfig({
  entry: {
    'bin/agrune': 'bin/agrune.ts',
    'src/program': 'src/program.ts',
    // C1 (PLAN): the programmatic execution API Studio imports. Emitted WITH declarations so
    // consumers get types (the CLI entries stay dts-less).
    'src/api': 'src/api.ts',
  },
  format: ['esm'],
  target: 'node18',
  platform: 'node',
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: { entry: { 'src/api': 'src/api.ts' } },
  external: ['playwright', 'playwright-core'],
  // @agrune/manifest is a workspace (file:) build-time dep — inline it so the published `agrune`
  // dist stays self-contained (zod remains external, shared with the core's own zod).
  noExternal: ['@agrune/manifest'],
  define: {
    __AGRUNE_CLI_VERSION__: JSON.stringify(pkg.version),
  },
  async onSuccess() {
    // Ship the bundled SKILL.md adjacent to the built CLI so `agrune install --skills` finds it.
    mkdirSync(new URL('./dist/src/skill/', import.meta.url), { recursive: true })
    copyFileSync(
      new URL('./src/skill/SKILL.md', import.meta.url),
      new URL('./dist/src/skill/SKILL.md', import.meta.url),
    )
  },
})
