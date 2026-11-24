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
    // Send both requests before leaving the board route or replacing its view.
    await Promise.all([
      executeCommand('Layout.setPathName', idePath + url.search),
      executeCommand('SideBar.show', 'Explorer'),
    ])
  }
}

await activate()
registerCommand({ execute: showIdeLayout, id: 'chat2.showIdeLayout' })
