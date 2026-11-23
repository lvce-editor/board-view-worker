import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

export const extension = fileURLToPath(
  new URL('../../board-view-worker/', import.meta.url),
)
export const buildExtension = async (minify: boolean): Promise<void> => {
  await build({
    bundle: true,
    entryPoints: [
      `${extension}/src/boardWorkerMain.ts`,
      `${extension}/src/descriptionMarkdownWorkerMain.ts`,
    ],
    external: ['electron', 'node:*'],
    format: 'esm',
    minify,
    outdir: `${extension}/dist`,
    platform: 'browser',
    target: 'esnext',
  })
}

if (import.meta.main) {
  await buildExtension(false)
}
