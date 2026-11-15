import test from 'node:test'
import assert from 'node:assert/strict'
import { publicSessionView, previewText, renderSharePage, SHARE_TOKEN_RE } from '../src/utils/sessionShare.js'

const session = {
  title: 'Alba <b>', date: new Date('2026-05-01'), startTime: '05:30', endTime: '09:00', technique: 'spinning',
  location: { name: 'Molo', region: 'Lazio', coords: { lat: 1, lng: 2 }, notes: 'segreto' },
  notes: 'privato', userId: 'u1', shareToken: 'abc',
  catches: [{ species: 'Spigola', lengthCm: 55.5, baitUsed: 'x', media: [{ type: 'photo', filename: 'a.jpg' }] }],
  media: [{ type: 'video', filename: 'v.mp4' }]
}

test('la vista pubblica non espone coordinate, note, esche o id utente', () => {
  const v = publicSessionView(session, { displayName: 'Mauro' }, 'http://h')
  const json = JSON.stringify(v)
  for (const leak of ['segreto', 'privato', 'coords', 'u1', 'abc', 'baitUsed']) assert.ok(!json.includes(leak), leak)
  assert.equal(v.author, 'Mauro')
  assert.deepEqual(v.duration, { hours: 3, minutes: 30 })
  assert.equal(v.photos[0].url, 'http://h/uploads/a.jpg')
})

test('anteprima e pagina OG escapano l\'HTML', () => {
  const v = publicSessionView(session, null, 'http://h')
  assert.match(previewText(v), /1 cattura · Spigola 55,5 cm · 3h30/)
  const html = renderSharePage(v, 'http://c/uscita/x')
  assert.ok(!html.includes('<b>'))
  assert.match(html, /og:image/)
})

test('formato token', () => {
  assert.ok(SHARE_TOKEN_RE.test('abcDEF123_-x'))
  assert.ok(!SHARE_TOKEN_RE.test('../etc'))
})
