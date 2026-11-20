import { expect, test } from '@jest/globals'
import {
  getBoardHash,
  getBoardPath,
  parseBoardHash,
} from '../src/parts/BoardUrl/BoardUrl.ts'

test('board routes retain prefixes and accept both existing aliases', () => {
  expect(
    getBoardPath(
      'https://editor.test/deploy/chat?workspace=one',
      '/deploy/commit',
    ),
  ).toBe('/deploy/boards')
  expect(parseBoardHash('https://editor.test/board/#5k8NLHLh')).toEqual({
    id: '5k8NLHLh',
    type: 'board',
  })
  expect(
    parseBoardHash('https://editor.test/deploy/boards/#board%20id'),
  ).toEqual({ id: 'board id', type: 'board' })
  expect(parseBoardHash('https://editor.test/chat/#task')).toEqual({
    type: 'none',
  })
  expect(parseBoardHash('https://editor.test/boards/#%')).toEqual({
    type: 'invalid',
  })
})

test('round-trips card URLs and rejects malformed card fragments', () => {
  const hash = getBoardHash('5k8NLHLh', 'with characters #/')
  expect(hash).toBe('#5k8NLHLh/card/with%20characters%20%23%2F')
  expect(
    parseBoardHash(`https://editor.test/deploy/boards/?workspace=one${hash}`),
  ).toEqual({
    cardId: 'with characters #/',
    id: '5k8NLHLh',
    type: 'card',
  })
  for (const fragment of [
    '5k8NLHLh/card/',
    '5k8NLHLh/card/%',
    '5k8NLHLh/card/a/b',
  ]) {
    expect(parseBoardHash(`https://editor.test/board/#${fragment}`)).toEqual({
      type: 'invalid',
    })
  }
})
