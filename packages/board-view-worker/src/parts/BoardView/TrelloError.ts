export interface BoardError {
  readonly code: string
  readonly message: string
}

export class TrelloError extends Error {
  constructor(readonly details: BoardError) {
    super(details.message)
  }
}
