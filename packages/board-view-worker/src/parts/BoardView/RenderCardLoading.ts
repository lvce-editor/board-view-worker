import { VirtualDomElements } from '@lvce-editor/virtual-dom-worker'
import * as Dom from '../VirtualDom/VirtualDom.ts'

export const renderCardLoading = (): Dom.Node =>
  Dom.node(
    VirtualDomElements.Div,
    { className: 'BoardCardLoading', onKeyDown: 'handleDialogKeyDown' },
    [
      Dom.node(VirtualDomElements.Span, { role: 'status' }, [
        Dom.textNode('Loading card details…'),
      ]),
      Dom.button('board-card-cancel', '', 'BoardDialogClose', {
        ariaLabel: 'Close card',
      }),
    ],
  )

export const renderCardStartupError = (): Dom.Node =>
  Dom.div(
    'BoardCardLoading',
    [
      Dom.node(VirtualDomElements.Span, { role: 'alert' }, [
        Dom.textNode('Unable to load card details. Try again.'),
      ]),
      Dom.button('board-card-details-retry', 'Try again', 'BoardButton'),
      Dom.button('board-card-cancel', '', 'BoardDialogClose', {
        ariaLabel: 'Close card',
      }),
    ],
    { onKeyDown: 'handleDialogKeyDown' },
  )
