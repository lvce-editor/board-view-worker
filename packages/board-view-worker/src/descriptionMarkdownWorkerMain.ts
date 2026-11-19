import { WebWorkerRpcClient } from '@lvce-editor/rpc'
import { renderDescriptionMarkdown } from './parts/BoardView/DescriptionMarkdown.ts'

const globalScope = globalThis as typeof globalThis & { rpc?: unknown }

if (!globalScope.rpc) {
  globalScope.rpc = await WebWorkerRpcClient.create({
    commandMap: {
      'BoardDescriptionMarkdown.render': renderDescriptionMarkdown,
    },
  })
}
