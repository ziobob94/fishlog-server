# Attività dei pesci e specie probabili

> **Stima indicativa, non validata.** Le regole qui sotto sono un'ipotesi ragionata, non un modello calibrato su catture reali.
> Il client mostra sempre l'etichetta «Indicativa», livelli in parole e mai promesse di catture.
> Prima di mostrarla a tutti va validata con dati reali (sezione [Come validarle](#come-validarle)).

## Dove sta il codice

| Cosa | File |
|---|---|
| Regole e pesi (default) | `src/data/fishingRules.json` |
| Profili delle specie (stagione, temperatura, preferenze) | `src/data/speciesProfiles.json` |
| Calcolo dell'attività (funzioni pure) | `src/utils/fishingActivity.js` |
| Calcolo delle specie probabili (funzioni pure) | `src/utils/speciesLikelihood.js` |
| Collegamento con il pannello meteo e lo storico utente | `src/utils/fishingDay.js` |
| Endpoint | `GET /api/weather/fishing` e il campo `daily[].activity` di `GET /api/weather` |
| Test | `tests/fishingActivity.test.js` (`npm test`) |

## Configurare le regole

I default sono in `src/data/fishingRules.json`. Per cambiarli senza toccare il codice si mette la chiave `fishing.rules` in `config/local.json` (o nell'override runtime): viene fusa in profondità con i default, quindi basta indicare i valori diversi.

```json
{ "fishing": { "rules": { "wind": { "idealMaxKmh": 12 }, "weights": { "tide": 0.35, "light": 0.2 } } } }
```

Gli array (come `levels`) si sostituiscono per intero. `version` va incrementata quando si cambiano le regole, perché finisce nella risposta (`rulesVersion`) e serve a confrontare le validazioni.

## Come si calcola l'attività

Per ogni ora del giorno si calcolano fino a cinque fattori da 0 a 1. Un fattore senza dati è **escluso** (mai trattato come 0) e i pesi degli altri si rinormalizzano; con meno di 2 fattori (`minFactors`) l'ora non ha stima.

| Fattore | Peso | Regola |
|---|---|---|
| `light` luce | 0,30 | Massimo (1,0) all'alba e al tramonto, scende linearmente a 0,45 di giorno e a 0,35 di notte entro 90 minuti. Di notte si aggiunge fino a +0,25 con la luna illuminata. |
| `tide` marea | 0,25 | Velocità di variazione del livello del mare (m/h) rispetto alla massima del giorno: 0,2 + 0,8 × rapporto; sotto il 15 % (acqua quasi ferma) vale 0,2. Se il livello oscilla meno di 5 cm nel giorno (marea trascurabile, lago, fiume) il fattore non si usa. La marea è un'**approssimazione** del modello, non una tavola ufficiale. |
| `pressure` pressione | 0,20 | Variazione nelle 3 ore precedenti: lieve calo (da −3 a −0,5 hPa) 1,0; stabile 0,6; lieve aumento 0,55; calo forte (< −3) 0,4; aumento forte (> +3) 0,35. |
| `wind` vento | 0,15 | 1,0 fino a 15 km/h, scende linearmente a 0,1 a 35 km/h. |
| `waterTemp` temperatura dell'acqua | 0,10 | 1,0 tra 14 e 22 °C, scende a 0,1 a 6 °C e a 30 °C. Solo con dati mare. |

Punteggio del giorno: media delle **6 ore migliori**. Livelli (`levels`): ≤ 0,30 Scarsa · ≤ 0,45 Bassa · ≤ 0,60 Media · ≤ 0,75 Buona · oltre Ottima.
Le **finestre più favorevoli** sono ore consecutive con punteggio ≥ max(0,6; massimo del giorno − 0,08), al massimo due.
«Cosa pesa nella stima»: per ogni fattore la media del giorno diventa una parola (favorevole ≥ 0,62, sfavorevole ≤ 0,40, altrimenti neutro) con una frase prudente.

**Oggi.** L'elenco `hourly` del pannello parte dall'ora corrente, ma per il calcolo dell'attività di oggi si aggiungono le ore già trascorse (da mezzanotte) prese da Open-Meteo (`past_hours=24`), così la giornata è completa anche a sera e la temperatura dell'acqua conta per tutte le ore. Se Open-Meteo non risponde si torna al comportamento precedente (stima parziale o assente). Se il blocco `current` marino manca ma ci sono le ore, la temperatura del mare ripiega sull'ora più vicina. Pesi e soglie non cambiano.

**Orizzonte.** Attività solo per i primi 7 giorni (servono ore, pressione e mare). Oltre il 7º giorno `activity` è `null` e restano solo le specie per stagione.
**Affidabilità** della previsione: alta fino al 3º giorno, media fino al 7º, bassa oltre.

## Specie probabili

Per ogni profilo compatibile con l'ambiente (mare se ci sono dati marini, altrimenti acqua dolce):
`punteggio = 0,5 × stagione + 0,3 × temperatura dell'acqua + 0,2 × condizioni` (pesi rinormalizzati se un termine manca; oltre 7 giorni resta solo la stagione).
**Storico dell'utente:** +0,04 per ogni cattura della stessa specie entro 15 km dal luogo, massimo +0,20. Le catture si cercano nel testo libero `catches.species` (nome e alias del profilo, senza distinzione di maiuscole).
Livelli (`species.levels`): ≤ 0,35 Meno probabile · ≤ 0,55 Possibile · ≤ 0,75 Probabile · oltre Molto probabile; sotto 0,25 la specie non appare. Ogni riga ha un motivo in una frase.

## Come validarle

Obiettivo: sapere se gli indici dicono qualcosa di vero **prima** di mostrarli a tutti.

1. **Dati.** Dallo storico (`Session` con `location.coords`, `date`, `startTime`/`endTime` e `catches[].time`) costruire coppie ora-di-pesca → catture. Servono i fattori di quel momento: si possono ricalcolare dall'archivio Open-Meteo (`archive-api` per meteo, pressione e mare). Si escludono le uscite senza orari o coordinate.
2. **Indice di riferimento.** Catture per ora di pesca (CPUE) per uscita, per non premiare chi pesca di più.
3. **Controllo.** Per ogni ora o uscita confrontare la CPUE con il livello previsto: CPUE media per livello (deve salire da Scarsa a Ottima) e correlazione di Spearman tra punteggio e CPUE. Confrontare con una linea di base banale (solo alba/tramonto) e con un'assegnazione casuale: l'indice deve batterle.
4. **Fattore per fattore.** Ripetere per ogni fattore, per capire quali pesi sono sbagliati e correggerli in `fishingRules.json` (aumentando `version`).
5. **Soglia per mostrarla a tutti.** Ragionevole: almeno ~300 uscite con orari su più stagioni e zone, un andamento monotono della CPUE tra i livelli e un vantaggio chiaro sulla linea di base. Sotto soglia restare dietro un flag (solo admin o beta) con etichetta «Indicativa».
6. **Specie.** Per ogni specie confrontare la stagione del profilo con la distribuzione mensile reale delle catture della community (la scheda specie già la calcola) e correggere `season` e `waterTemp`.
7. **Dopo il lancio.** Salvare (con consenso) livello previsto e cattura reale per ricalibrare ogni trimestre.

Limiti da dichiarare: le catture non registrano le ore senza pesci (si pesca dove e quando si pensa di prendere), quindi la CPUE è distorta; la marea nel Mediterraneo è piccola e il modello è grossolano.

## «In stagione» (`GET /api/species/seasonal`)

Elenco della schermata Specie: le specie più comuni del mese, solo dalla stagione dei profili (`speciesProfiles.json`, campo `season`, 12 valori). Parametri: `month` (1-12, default il mese corrente), `lat`/`lng` opzionali. La zona è una macro-area dalla latitudine (nord ≥ 44°, centro ≥ 41,5°, sud) oppure `italia` senza posizione. Per ora **le curve sono uguali in tutte le zone**: un profilo può avere `seasonByZone: { nord|centro|sud: [12 valori] }` per differenziarle. Sono dati editoriali **indicativi, non validati**; la risposta porta `indicative: true`. Ordine: livello, catture dell'utente (entro 50 km, o ovunque senza posizione), nome; massimo `species.maxItems` (8).
