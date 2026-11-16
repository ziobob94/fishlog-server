import { test } from 'node:test'
import assert from 'node:assert'
import { withMediaUrls } from '../src/utils/mediaUrls.js'

test('aggiunge url ai media di sessione e catture', () => {
  const s = withMediaUrls({ media: [{ filename: 'a.jpg' }], catches: [{ species: 'x', media: [{ filename: 'b.jpg' }] }, { species: 'y' }] }, 'http://h')
  assert.equal(s.media[0].url, 'http://h/uploads/a.jpg')
  assert.equal(s.catches[0].media[0].url, 'http://h/uploads/b.jpg')
  assert.equal(s.catches[1].media, undefined)
})
