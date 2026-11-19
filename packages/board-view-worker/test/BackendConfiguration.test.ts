import { expect, jest, test } from '@jest/globals'
import { resolveBackendConfiguration } from '../src/parts/BackendConfiguration/BackendConfiguration.ts'

test('uses editor auth and refresh for the editor backend without chat activation', async () => {
  const getAccessToken = jest
    .fn<
      (options?: {
        readonly refresh?: 'if-needed' | 'always'
      }) => Promise<string>
    >()
    .mockResolvedValue('editor-token')
  const config = await resolveBackendConfiguration({
    executeCommand: jest
      .fn<(...args: readonly unknown[]) => Promise<unknown>>()
      .mockResolvedValue('https://backend.test'),
    getAccessToken,
    getPreference: jest
      .fn<(key: string) => Promise<unknown>>()
      .mockResolvedValue('https://backend.test/'),
  })
  expect(config.accessToken).toBe('editor-token')
  expect(getAccessToken).toHaveBeenCalledWith({ refresh: 'if-needed' })
  expect(await config.refreshAccessToken?.()).toBe('editor-token')
  expect(getAccessToken).toHaveBeenLastCalledWith({ refresh: 'always' })
})

test('does not send editor credentials to a configured third-party backend', async () => {
  const getAccessToken = jest
    .fn<
      (options?: {
        readonly refresh?: 'if-needed' | 'always'
      }) => Promise<string>
    >()
    .mockResolvedValue('editor-token')
  const config = await resolveBackendConfiguration({
    executeCommand: jest
      .fn<(...args: readonly unknown[]) => Promise<unknown>>()
      .mockResolvedValue('https://backend.test'),
    getAccessToken,
    getPreference: jest
      .fn<(key: string) => Promise<unknown>>()
      .mockResolvedValue('https://other.test'),
  })
  expect(config.accessToken).toBe('')
  expect(config.refreshAccessToken).toBeUndefined()
  expect(getAccessToken).not.toHaveBeenCalled()
})
