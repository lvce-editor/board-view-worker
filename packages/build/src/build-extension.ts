import { build, type BuildOptions } from 'esbuild'
import { fileURLToPath } from 'node:url'

export const extension = fileURLToPath(
  new URL('../../board-view-worker/', import.meta.url),
)
const workerBuildOptions = {
  bundle: true,
  external: ['electron', 'node:*'],
  format: 'esm',
  platform: 'browser',
  target: 'esnext',
} satisfies BuildOptions

export const buildExtension = async (minify: boolean): Promise<void> => {
  await build({
    ...workerBuildOptions,
    entryPoints: [
      `${extension}/src/boardWorkerMain.ts`,
      `${extension}/src/cardDetailWorkerMain.ts`,
      `${extension}/src/descriptionMarkdownWorkerMain.ts`,
    ],
    minify,
    outdir: `${extension}/dist`,
  })
}

export const buildStandaloneBoardWorker = async (
  outfile: string,
): Promise<void> => {
  await build({
    ...workerBuildOptions,
    entryPoints: [`${extension}/src/standaloneBoardWorkerMain.ts`],
    minify: true,
    outfile,
  })
}

if (import.meta.main) {
  await buildExtension(false)
}
