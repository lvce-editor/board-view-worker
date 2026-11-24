import { executeCommand, registerCommand } from '@lvce-editor/api'
import { getIdePath, getUrl } from './parts/BoardUrl/BoardUrl.ts'
import { activate } from './parts/Main/Main.ts'

const showIdeLayout = async (): Promise<void> => {
  await executeCommand('Layout.leaveSideBarFocusMode')
  const href = await executeCommand('Layout.getHref')
  const url = typeof href === 'string' ? getUrl(href) : undefined
  if (!url) return
  const idePath = getIdePath(url.pathname)
  if (idePath !== url.pathname) {
    await executeCommand('Layout.setPathName', idePath + url.search)
  }
}

await activate()
registerCommand({ execute: showIdeLayout, id: 'chat2.showIdeLayout' })
