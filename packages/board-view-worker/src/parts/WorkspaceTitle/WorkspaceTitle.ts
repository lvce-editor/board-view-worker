import { executeCommand } from '@lvce-editor/api'

const pathSeparatorRegex = /[\\/]/

export const getWorkspaceTitle = async (
  execute: typeof executeCommand = executeCommand,
): Promise<string> => {
  try {
    const workspacePath = await execute('Workspace.getPath')
    if (typeof workspacePath !== 'string' || !workspacePath)
      return 'Lvce Editor'
    return workspacePath.split(pathSeparatorRegex).at(-1) || 'Lvce Editor'
  } catch {
    return 'Lvce Editor'
  }
}
