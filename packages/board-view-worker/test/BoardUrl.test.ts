import { expect, test } from '@jest/globals'
import { getBoardPath, parseBoardHash } from '../src/parts/BoardUrl/BoardUrl.ts'

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
