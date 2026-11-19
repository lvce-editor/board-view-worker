import { createRpc } from '@lvce-editor/api'
import type { Node } from '../VirtualDom/VirtualDom.ts'

interface DescriptionMarkdownRpc {
  readonly dispose: () => Promise<void> | void
  readonly invoke: (
    method: string,
    ...params: readonly unknown[]
  ) => Promise<unknown>
}

const rpcId = 'builtin.board-view.description-markdown-worker'
const state: { rpcPromise: Promise<DescriptionMarkdownRpc> | undefined } = {
  rpcPromise: undefined,
}

const getRpc = (): Promise<DescriptionMarkdownRpc> => {
  const { rpcPromise } = state
  if (rpcPromise) return rpcPromise
  const newRpcPromise = createRpc({
    id: rpcId,
  }) as unknown as Promise<DescriptionMarkdownRpc>
  state.rpcPromise = newRpcPromise
  void newRpcPromise.catch(() => {
    const { rpcPromise: currentRpcPromise } = state
    if (currentRpcPromise === newRpcPromise) state.rpcPromise = undefined
  })
  return newRpcPromise
}

export const renderDescriptionMarkdown = async (
  text: string,
): Promise<Node> => {
  const rpcPromise = getRpc()
  const rpc = await rpcPromise
  try {
    const result = await rpc.invoke('BoardDescriptionMarkdown.render', text)
    return result as Node
  } catch (error) {
    const { rpcPromise: currentRpcPromise } = state
    if (currentRpcPromise === rpcPromise) {
      state.rpcPromise = undefined
      try {
        await rpc.dispose()
      } catch {
        // Ignore disposal errors so the caller can show a retry action.
      }
    }
    throw error
  }
}
