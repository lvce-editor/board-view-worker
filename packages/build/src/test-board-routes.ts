import assert from 'node:assert/strict'
import type { Browser } from 'playwright'

export const testBoardRoutes = async (
  browser: Browser,
  baseUrl: string,
): Promise<void> => {
  for (const route of ['board', 'boards']) {
    const context = await browser.newContext()
    try {
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`${baseUrl}${route}`)
      await page.locator('.BoardProviderGrid').waitFor()
      await page.reload()
      await page.locator('.BoardProviderGrid').waitFor()
      assert.deepEqual(errors, [], `${route} route should load without errors`)
    } finally {
      await context.close()
    }
  }
  process.stdout.write('Board route aliases and reload: pass\n')
}
