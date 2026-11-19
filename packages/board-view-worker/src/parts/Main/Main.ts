import {
  activate as activateExtensionApi,
  executeCommand,
  registerCommand,
  registerView,
} from '@lvce-editor/api'
import { getBoardPath, getUrl, isBoardPath } from '../BoardUrl/BoardUrl.ts'
import { view, viewId } from '../BoardView/BoardView.ts'

const state = { activationPromise: undefined as Promise<void> | undefined }

export const showBoardLayout = async (): Promise<void> => {
  await executeCommand('Layout.leaveSideBarFocusMode')
  try {
    const href = await executeCommand('Layout.getHref')
    const url = typeof href === 'string' ? getUrl(href) : undefined
    if (url && (url.protocol === 'http:' || url.protocol === 'https:')) {
      const assetDir = await executeCommand('Layout.getAssetDir')
      if (typeof assetDir === 'string') {
        if (!isBoardPath(url.pathname)) url.hash = ''
        url.pathname = getBoardPath(url.href, assetDir)
        await executeCommand(
          'Layout.setPathName',
          `${url.pathname}${url.search}${url.hash}`,
        )
      }
    } else {
      await executeCommand('Layout.setHash', '')
    }
  } catch {
    // Older editor builds do not expose URL commands.
  }
  await executeCommand('SideBar.show', viewId, true)
  await executeCommand('Layout.enterSideBarFocusMode', 'primary', true)
}

const activateMain = async (): Promise<void> => {
  await activateExtensionApi()
  registerView(view)
  registerCommand({ execute: showBoardLayout, id: 'chat2.showBoardLayout' })
  try {
    const href = await executeCommand('Layout.getHref')
    const url = typeof href === 'string' ? getUrl(href) : undefined
    if (url && isBoardPath(url.pathname)) {
      await executeCommand('SideBar.show', viewId, true)
      await executeCommand('Layout.enterSideBarFocusMode', 'primary', true)
    }
  } catch {
    // The editor may not expose URL commands during activation.
  }
}

export const activate = (): Promise<void> => {
  state.activationPromise ||= activateMain()
  return state.activationPromise
}

export const deactivate = (): void => {}
