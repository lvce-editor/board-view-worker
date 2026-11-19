import { packageExtension } from '@lvce-editor/package-extension'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { extension } from './build-extension.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const dist = `${root}/dist`
await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
for (const asset of ['dist', 'media', 'extension.json']) {
  await cp(`${extension}/${asset}`, `${dist}/${asset}`, { recursive: true })
}
for (const asset of ['README.md', 'LICENSE']) {
  await cp(`${root}/${asset}`, `${dist}/${asset}`)
}
const packageJson = JSON.parse(
  await readFile(`${extension}/package.json`, 'utf8'),
)
const version = (
  process.env.GIT_TAG ||
  process.env.RG_VERSION ||
  '0.0.0-dev'
).replace(/^v/, '')
await writeFile(
  `${dist}/package.json`,
  JSON.stringify(
    {
      name: packageJson.name,
      version,
      description: packageJson.description,
      type: 'module',
      main: 'dist/boardWorkerMain.js',
      license: 'MIT',
      repository: {
        type: 'git',
        url: 'git+https://github.com/lvce-editor/board-view-worker.git',
      },
      files: ['dist', 'media', 'extension.json', 'README.md', 'LICENSE'],
    },
    null,
    2,
  ) + '\n',
)
await packageExtension({
  inDir: dist,
  outFile: `${root}/extension.tar.br`,
  highestCompression: true,
})
