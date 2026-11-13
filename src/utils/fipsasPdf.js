import PDFDocument from 'pdfkit'

// PDF A4 delle classifiche. Intestazione di testo (nessun logo della Federazione), orario di stampa,
// direttore e giudice di gara a piè di pagina. Verticale per giornata e squadre, orizzontale per le altre.
const ORIENT = { 'settori-pieni': 'landscape', settore: 'landscape', giornata: 'portrait', progressiva: 'landscape', squadre: 'portrait' }
const num = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','))
const mil = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('it-IT') : '')

export function buildPdf(prova, cl, docs, { direttore, giudice }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false, bufferPages: true, margin: 36, size: 'A4' })
    const chunks = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const orario = new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
    const data = new Date(prova.data).toLocaleDateString('it-IT')
    const stampati = []   // [indice pagina]

    function nuovaPagina(layout, titolo) {
      doc.addPage({ size: 'A4', layout, margin: 36 })
      stampati.push(doc.bufferedPageRange().count - 1)
      doc.font('Helvetica-Bold').fontSize(13).text(titolo, { align: 'center' })
      doc.moveDown(0.3).font('Helvetica').fontSize(8.5)
      const righe = [
        ['Organizzazione', prova.organizzazione], ['Manifestazione', prova.manifestazione], ['Prova nr.', String(prova.provaNumero)],
        ['Campo di gara', prova.campoDiGara], ['Data', data], ['Società organizzatrice', prova.societaOrganizzatrice]
      ]
      for (const [k, v] of righe) doc.font('Helvetica-Bold').text(`${k}: `, { continued: true }).font('Helvetica').text(v || '-')
      doc.moveDown(0.6)
    }

    function tabella(layout, titolo, cols, righe) {
      nuovaPagina(layout, titolo)
      const larg = doc.page.width - 72
      const tot = cols.reduce((s, c) => s + c.w, 0)
      const w = cols.map((c) => (c.w / tot) * larg)
      const riga = (vals, bold) => {
        if (doc.y > doc.page.height - 70) { nuovaPagina(layout, `${titolo} (segue)`); intest() }
        let x = 36; const y = doc.y
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8)
        vals.forEach((v, i) => { doc.text(String(v ?? ''), x + 2, y, { width: w[i] - 4, align: cols[i].right ? 'right' : 'left', lineBreak: false }); x += w[i] })
        doc.y = y + 12
        doc.moveTo(36, doc.y - 1).lineTo(36 + larg, doc.y - 1).lineWidth(0.3).strokeColor('#999').stroke()
      }
      const intest = () => riga(cols.map((c) => c.h), true)
      intest()
      for (const r of righe) riga(r, false)
    }

    const titoli = prova.titoli || {}
    for (const d of docs) {
      const layout = ORIENT[d]
      if (d === 'settori-pieni') {
        tabella(layout, 'SETTORI PIENI', [{ h: 'Settore', w: 8 }, { h: 'Gara', w: 7 }, { h: 'Concorrente', w: 40 }, { h: 'Società', w: 40 }, { h: 'Sq', w: 5 }],
          cl.settori.flatMap((s) => [...s.righe].sort((a, b) => a.gara - b.gara).map((r) => [s.lettera, r.gara, `${r.cognome} ${r.nome}`, r.societa, r.squadra])))
      } else if (d === 'settore') {
        for (const s of cl.settori) {
          tabella(layout, titoli.settore || `CLASSIFICA DI SETTORE ${s.lettera}`,
            [{ h: 'Posto', w: 6, right: true }, { h: 'Gara', w: 6, right: true }, { h: 'Concorrente', w: 28 }, { h: 'Società', w: 28 }, { h: 'Conversione', w: 10, right: true },
              { h: 'Tot. catture', w: 9, right: true }, { h: 'Bonus', w: 8, right: true }, { h: 'Punt. effett.', w: 10, right: true }, { h: 'Pen. effett.', w: 9, right: true }, { h: 'Sq', w: 4 }],
            s.righe.map((r) => [num(r.penalita), r.gara, `${r.cognome} ${r.nome}`, r.societa, mil(r.conversione), r.catture, mil(r.bonus), mil(r.punteggio), num(r.penalita), r.squadra]))
        }
      } else if (d === 'giornata') {
        tabella(layout, titoli.giornata || 'CLASSIFICA DI GIORNATA INDIVIDUALE',
          [{ h: 'Class.', w: 7, right: true }, { h: 'Cognome', w: 22 }, { h: 'Nome', w: 20 }, { h: 'Società', w: 30 }, { h: 'Pen. effett.', w: 11, right: true }, { h: 'Peso', w: 10, right: true }],
          cl.giornata.map((r) => [r.classe, r.cognome, r.nome, r.societa, num(r.penalita), mil(r.punteggio)]))
      } else if (d === 'progressiva') {
        tabella(layout, titoli.progressiva || 'CLASSIFICA PROGRESSIVA INDIVIDUALE',
          [{ h: 'Class.', w: 6, right: true }, { h: 'Cognome', w: 18 }, { h: 'Nome', w: 16 }, { h: 'Società', w: 26 }, { h: 'Piazz. tot.', w: 9, right: true },
            { h: 'Piazz. (prove)', w: 14 }, { h: 'Punteggio eff. tot.', w: 12, right: true }, { h: 'Catture totali', w: 9, right: true }],
          cl.progressiva.map((r) => [r.classe, r.cognome, r.nome, r.societa, num(r.piazzTot), r.piazzProve.map(num).join(' - '), mil(r.punteggioTot), r.catture]))
      } else if (d === 'squadre') {
        tabella(layout, titoli.squadre || 'CLASSIFICA PROGRESSIVA SQUADRE',
          [{ h: 'Class.', w: 7, right: true }, { h: 'Società', w: 32 }, { h: 'Sq', w: 5 }, { h: 'Pen. eff.', w: 10, right: true }, { h: 'Pen. singole prove', w: 18 }, { h: 'Peso totale', w: 12, right: true }],
          cl.squadre.map((r) => [r.classe, r.societa, r.squadra, num(r.penalita), r.penaliteProve.map(num).join(' - '), mil(r.peso)]))
      }
    }

    // piè di pagina su ogni pagina
    const n = doc.bufferedPageRange().count
    for (let i = 0; i < n; i++) {
      doc.switchToPage(i)
      const y = doc.page.height - 40
      doc.font('Helvetica').fontSize(8).fillColor('#000')
      const prev = doc.page.margins.bottom
      doc.page.margins.bottom = 0
      doc.text(`Stampata il ${orario}`, 36, y, { lineBreak: false })
      doc.text(`Direttore di gara: ${direttore || '-'}`, 36, y, { width: doc.page.width - 72, align: 'center', lineBreak: false })
      doc.text(`Giudice di gara: ${giudice || '-'}`, 36, y, { width: doc.page.width - 72, align: 'right', lineBreak: false })
      doc.page.margins.bottom = prev
    }
    doc.end()
  })
}
