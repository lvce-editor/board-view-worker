import assert from 'node:assert/strict'
import { cp, readFile, rm } from 'node:fs/promises'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { chromium } from 'playwright'
import { root } from './root.ts'
import { testBoardSelection } from './test-board-selection.ts'
import { testBoardRoutes } from './test-board-routes.ts'
import './build-static.ts'

const directory = resolve(root, 'dist')
const prefix = '/board-view-worker/'
const mimeTypes: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}
const serve = async (
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  try {
    const url = new URL(request.url || '/', 'http://localhost')
    assert.ok(url.pathname.startsWith(prefix))
    const file = resolve(
      directory,
      decodeURIComponent(url.pathname.slice(prefix.length)),
    )
    assert.ok(file === directory || file.startsWith(directory + sep))
    const target = extname(file) ? file : join(file, 'index.html')
    const content = await readFile(target)
    if (!extname(file) && !url.pathname.endsWith('/')) {
      response.writeHead(301, {
        Location: `${url.pathname}/${url.search}${url.hash}`,
      })
    } else {
      response.writeHead(200, {
        'Content-Type':
          mimeTypes[extname(target)] || 'application/octet-stream',
      })
    }
    response.end(content)
  } catch {
    response.writeHead(404)
    response.end()
  }
}
const server = createServer((request, response) => {
  void serve(request, response)
})
await new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const baseUrl = `http://127.0.0.1:${address.port}${prefix}`
  browser = await chromium.launch({
    headless: process.argv.includes('--headless'),
  })
  await testBoardRoutes(browser, baseUrl)
  await testBoardSelection(browser, baseUrl)
} finally {
  await browser?.close()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  await rm(directory, { recursive: true, force: true })
  await cp(join(root, '.tmp', 'package'), directory, { recursive: true })
}
