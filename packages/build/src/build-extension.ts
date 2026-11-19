import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

export const extension = fileURLToPath(
  new URL('../../board-view-worker/', import.meta.url),
)
await build({
  bundle: true,
  entryPoints: [`${extension}/src/boardWorkerMain.ts`],
  external: ['electron', 'node:*'],
  format: 'esm',
  outfile: `${extension}/dist/boardWorkerMain.js`,
  platform: 'browser',
  target: 'esnext',
})
