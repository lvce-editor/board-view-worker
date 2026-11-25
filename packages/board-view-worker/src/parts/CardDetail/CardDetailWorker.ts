import type { Rpc } from '@lvce-editor/rpc'
import { createRpc } from '@lvce-editor/api'
import type {
  CardDetailHost,
  CardDetailHostMethod,
  ConnectCardDetail,
} from './CardDetailProtocol.ts'
import { TrelloError } from '../BoardView/TrelloError.ts'

const sessions = new Map<number, CardDetailHost>()
const state: { connection?: Promise<Rpc>; nextId: number } = { nextId: 0 }

const callHost = async (
  id: number,
  method: CardDetailHostMethod,
  args: readonly unknown[],
): Promise<unknown> => {
  const host = sessions.get(id)
  if (!host || !Object.hasOwn(host, method)) return {}
  try {
    const value: unknown = await Reflect.apply(host[method], host, args)
    return { value }
  } catch (error) {
    if (error instanceof TrelloError) return { error: error.details }
    throw error
  }
}

const createConnection = async (): Promise<Rpc> => {
  try {
    // The extension API launches the declared worker and transfers the RPC port.
    return await createRpc({
      commandMap: { 'BoardCardDetail.callHost': callHost },
      id: 'builtin.board-view.card-detail-worker',
    })
  } catch (error) {
    delete state.connection
    throw error
  }
}

export const connectCardDetail: ConnectCardDetail = (host) => {
  const id = state.nextId++
  sessions.set(id, host)
  let opened = false
  return async (action) => {
    if (action.type === 'dispose') {
      sessions.delete(id)
      if (opened) {
        const { connection } = state
        const rpc = await connection
        await rpc?.invoke('BoardCardDetail.dispatch', id, action)
      }
      return
    }
    if (!sessions.has(id)) return
    state.connection ??= createConnection()
    const { connection } = state
    const rpc = await connection
    if (!sessions.has(id)) return
    if (action.type === 'open') opened = true
    await rpc.invoke('BoardCardDetail.dispatch', id, action)
  }
}
