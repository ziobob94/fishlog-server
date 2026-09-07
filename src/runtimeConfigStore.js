import RuntimeConfig from './models/RuntimeConfig.js'

// Cache in memoria dei valori di configurazione salvati da admin (vedi
// configManifest.js). AppConfig.get() la consulta prima di leggere il file
// statico: così un salvataggio da interfaccia è immediato nel processo che
// l'ha ricevuto. In un deploy multi-processo (PM2 cluster) gli altri worker
// vedono il cambiamento al più tardi al prossimo refresh periodico
// (startPeriodicReload), senza bisogno di riavviare nulla.
let cache = {}

export function getOverride(key) {
  return cache[key]
}

export async function reloadRuntimeConfig() {
  const docs = await RuntimeConfig.find({}).lean()
  const next = {}
  for (const doc of docs) next[doc.key] = doc.value
  cache = next
}

export function startPeriodicReload(intervalMs = 30000) {
  setInterval(() => {
    reloadRuntimeConfig().catch(err => console.error('[runtimeConfigStore] reload fallito', err))
  }, intervalMs).unref()
}
