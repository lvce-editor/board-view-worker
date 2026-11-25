import { WebWorkerRpcClient } from '@lvce-editor/rpc'
import type {
  CardDetailAction,
  CardDetailHost,
  CardDetailHostMethod,
  DispatchCardDetail,
} from './parts/CardDetail/CardDetailProtocol.ts'
import { TrelloError, type BoardError } from './parts/BoardView/TrelloError.ts'
import { createCardDetail } from './parts/CardDetail/CardDetail.ts'

const sessions = new Map<number, DispatchCardDetail>()

const createHost = (id: number): CardDetailHost => {
  const call = async <Method extends CardDetailHostMethod>(
    method: Method,
    ...args: Parameters<CardDetailHost[Method]>
  ): Promise<Awaited<ReturnType<CardDetailHost[Method]>>> => {
    const { error, value } = (await rpc.invoke(
      'BoardCardDetail.callHost',
      id,
      method,
      args,
    )) as {
      readonly value: Awaited<ReturnType<CardDetailHost[Method]>>
      readonly error?: BoardError
    }
    if (error) throw new TrelloError(error)
    return value
  }
  // Notifications and state updates travel over the same ordered port.
  const send = <Method extends CardDetailHostMethod>(
    method: Method,
    ...args: Parameters<CardDetailHost[Method]>
  ): void => {
    void call(method, ...args).catch(() => {
      // The board can leave the view while these notifications are in flight.
    })
  }
  return {
    addAttachment: (file) => call('addAttachment', file),
    addComment: (text) => call('addComment', text),
    applyChange: (changes) => send('applyChange', changes),
    archiveCard: () => call('archiveCard'),
    close: (archived) => send('close', archived),
    copyCardLink: () => call('copyCardLink'),
    loadCard: () => call('loadCard'),
    loadDescriptionImages: (markdown) =>
      call('loadDescriptionImages', markdown),
    moveCard: (listId) => call('moveCard', listId),
    publish: (frame) => send('publish', frame),
    renderDescriptionMarkdown: (text) =>
      call('renderDescriptionMarkdown', text),
    updateCard: (name, desc) => call('updateCard', name, desc),
  }
}

const dispatch = (id: number, action: Readonly<CardDetailAction>): void => {
  if (action.type === 'open') sessions.set(id, createCardDetail(createHost(id)))
  void sessions.get(id)?.(action)
  if (action.type === 'dispose') sessions.delete(id)
}

const rpc = await WebWorkerRpcClient.create({
  commandMap: { 'BoardCardDetail.dispatch': dispatch },
})
