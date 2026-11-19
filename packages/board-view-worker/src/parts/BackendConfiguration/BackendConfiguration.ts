import { executeCommand, getAccessToken, getPreference } from '@lvce-editor/api'

export interface BackendConfiguration {
  readonly accessToken: string
  readonly baseUrl: string
  readonly refreshAccessToken?: () => Promise<string>
  readonly responseMethod: 'http' | 'websocket'
}

interface BackendConfigurationHost {
  readonly executeCommand: typeof executeCommand
  readonly getAccessToken: typeof getAccessToken
  readonly getPreference: typeof getPreference
}
const defaultHost: BackendConfigurationHost = {
  executeCommand,
  getAccessToken,
  getPreference,
}
const getString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''
const normalize = (value: string): string => {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end--
  return value.slice(0, end)
}
const read = async (operation: () => Promise<unknown>): Promise<unknown> => {
  try {
    return await operation()
  } catch {
    return ''
  }
}

export const resolveBackendConfiguration = async (
  host: BackendConfigurationHost = defaultHost,
): Promise<BackendConfiguration> => {
  const [configured, editor] = await Promise.all([
    read(() => host.getPreference('chat2.backendUrl')),
    read(() => host.executeCommand('Layout.getBackendUrl')),
  ])
  const editorBaseUrl = getString(editor)
  const baseUrl = getString(configured) || editorBaseUrl
  // Never forward the editor's access token to a preference-supplied backend.
  const usesEditorBackend = Boolean(
    baseUrl && editorBaseUrl && normalize(baseUrl) === normalize(editorBaseUrl),
  )
  const refresh = async (mode: 'if-needed' | 'always'): Promise<string> =>
    getString(await read(() => host.getAccessToken({ refresh: mode })))
  return {
    accessToken: usesEditorBackend ? await refresh('if-needed') : '',
    baseUrl,
    responseMethod: 'http',
    ...(usesEditorBackend && { refreshAccessToken: () => refresh('always') }),
  }
}
