// Dati statici del seeder: utenti, luoghi reali italiani e specie.

export const PASSWORD = 'Test1234!'
export const EMAIL_DOMAIN = 'fishlog.test'

// Due utenti hanno lo stesso displayName ("Mario Rossi") ma username/email diversi,
// per provare ricerca amici, classifica e profili con omonimi.
export const USERS = [
  { key: 'mario',  username: 'mario.rossi',   displayName: 'Mario Rossi',   bio: 'Surfcasting sulla costa laziale dal 2008.', city: ['Ostia (RM)', 41.73, 12.28], technique: 'surfcasting' },
  { key: 'marco',  username: 'marco.rossi',   displayName: 'Mario Rossi',   bio: 'Omonimo di Mario, ma io pesco a spinning sul Garda.', city: ['Peschiera del Garda (VR)', 45.44, 10.69], technique: 'spinning' },
  { key: 'giulia', username: 'giulia.bianchi', displayName: 'Giulia Bianchi', bio: 'Bolentino e uscite in barca in Adriatico.', city: ['Rimini', 44.06, 12.57], technique: 'bolentino' },
  { key: 'luca',   username: 'luca.verdi',    displayName: 'Luca Verdi',    bio: 'Feeder sui laghi, catch & release.', city: ['Passignano sul Trasimeno (PG)', 43.19, 12.14], technique: 'feeder' },
  { key: 'anna',   username: 'anna.neri',     displayName: 'Anna Neri',     bio: 'Mosca e trote in lago e fiume.', city: ['Stresa (VB)', 45.88, 8.53], technique: 'mosca' },
  { key: 'paolo',  username: 'paolo.conti',   displayName: 'Paolo Conti',   bio: 'Titolare di Conti Pesca, Livorno.', city: ['Livorno', 43.55, 10.31], technique: 'bolentino', shop: true },
  { key: 'sara',   username: 'sara.marino',   displayName: 'Sara',          bio: '', city: ['Alghero (SS)', 40.56, 8.31], technique: 'spinning' },
  { key: 'admin',  username: 'seed.admin',    displayName: 'Admin Test',    bio: 'Utente admin di prova.', city: ['Roma', 41.9, 12.5], technique: 'altro', role: 'admin' }
]

// Luoghi reali (coordinate approssimate di spiagge, moli e rive note).
export const SPOTS = {
  mare: [
    { name: 'Spiaggia di Ostia Lido', spot: 'Pontile di Ostia', region: 'Lazio', lat: 41.7317, lng: 12.2805 },
    { name: 'Rimini', spot: 'Molo di Levante', region: 'Emilia-Romagna', lat: 44.0693, lng: 12.5953 },
    { name: 'Gallipoli', spot: 'Baia Verde', region: 'Puglia', lat: 40.0425, lng: 17.9828 },
    { name: 'Alghero', spot: 'Bastioni', region: 'Sardegna', lat: 40.5577, lng: 8.3150 },
    { name: 'Livorno', spot: 'Diga Curvilinea', region: 'Toscana', lat: 43.5485, lng: 10.2986 },
    { name: 'Ortona', spot: 'Molo Nord', region: 'Abruzzo', lat: 42.3558, lng: 14.4072 },
    { name: 'Sanremo', spot: 'Molo Sud', region: 'Liguria', lat: 43.8160, lng: 7.7760 },
    { name: 'Siracusa', spot: 'Ortigia, Forte Vigliena', region: 'Sicilia', lat: 37.0614, lng: 15.2956 }
  ],
  lago: [
    { name: 'Lago di Garda', spot: 'Peschiera del Garda', region: 'Veneto', lat: 45.4392, lng: 10.6910 },
    { name: 'Lago Trasimeno', spot: 'Passignano sul Trasimeno', region: 'Umbria', lat: 43.1887, lng: 12.1357 },
    { name: 'Lago Maggiore', spot: 'Stresa', region: 'Piemonte', lat: 45.8832, lng: 8.5368 },
    { name: 'Lago di Como', spot: 'Lecco, Malgrate', region: 'Lombardia', lat: 45.8507, lng: 9.4038 },
    { name: 'Lago di Bolsena', spot: 'Capodimonte', region: 'Lazio', lat: 42.5440, lng: 11.9084 },
    { name: 'Lago d\'Iseo', spot: 'Sarnico', region: 'Lombardia', lat: 45.6767, lng: 9.9622 }
  ]
}

// [nome, peso min-max kg, lunghezza min-max cm]
export const SPECIES = {
  mare: [
    ['Orata', [0.4, 2.2], [26, 52]],
    ['Spigola', [0.5, 4.5], [32, 72]],
    ['Sarago', [0.2, 1.1], [20, 38]],
    ['Ombrina', [0.6, 3.0], [34, 62]],
    ['Ricciola', [2, 14], [60, 115]],
    ['Palamita', [0.8, 3.5], [40, 65]],
    ['Sgombro', [0.2, 0.7], [24, 38]],
    ['Triglia', [0.1, 0.4], [16, 28]]
  ],
  lago: [
    ['Lucioperca', [0.8, 6], [40, 85]],
    ['Luccio', [1, 9], [55, 105]],
    ['Black bass', [0.4, 2.8], [28, 50]],
    ['Carpa', [2, 15], [50, 90]],
    ['Persico reale', [0.2, 1.2], [20, 42]],
    ['Trota iridea', [0.5, 3], [30, 60]],
    ['Siluro', [8, 35], [110, 180]]
  ]
}

export const BAITS = {
  surfcasting: [['Bibi', 'naturale'], ['Americano', 'naturale'], ['Cannolicchio', 'naturale']],
  feeder: [['Pasturatore + mais', 'naturale'], ['Bigattini', 'naturale']],
  spinning: [['Minnow 11cm', 'artificiale'], ['Vinile 8cm', 'artificiale'], ['Ondulante', 'artificiale']],
  bolentino: [['Sardina', 'naturale'], ['Gambero', 'naturale']],
  mosca: [['Nymph #14', 'artificiale'], ['Secca CDC', 'artificiale']],
  altro: [['Calamaretto', 'naturale']]
}

export const TECHNIQUES = ['surfcasting', 'feeder', 'spinning', 'bolentino', 'mosca']

export const LISTINGS = [
  ['Canna surfcasting 4.20 m 150 g', 'canne', 'usato', 85, 'Canna in carbonio, usata due stagioni, nessun difetto.'],
  ['Mulinello Shimano 4000 FB', 'mulinelli', 'usato', 60, 'Frizione perfetta, con bobina di scorta.'],
  ['Set minnow e vinili da spinning', 'esche', 'nuovo', 35, 'Venti pezzi assortiti, mai usati.'],
  ['Scatola ami e terminali bolentino', 'ami_terminali', 'nuovo', 18, 'Ami n. 2-6 e terminali fluorocarbon.'],
  ['Giacca antipioggia taglia L', 'abbigliamento', 'usato', 45, 'Impermeabile, ottime condizioni.'],
  ['Guadino telescopico', 'accessori', 'nuovo', 29, 'Manico 2,5 m, testa pieghevole.'],
  ['Gommone 3,2 m con motore 5 cv', 'imbarcazioni', 'usato', 1400, 'Revisionato, ideale per laghi e coste.'],
  ['Carica di galleggianti vari', 'altro', 'usato', 12, 'Lotto di galleggianti da feeder e carpfishing.']
]
