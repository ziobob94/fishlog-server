import pkg from 'config'

export default class AppConfig {

  constructor() {
    this._validate()
  }

  _validate() {
    const required = [
      'api.port',
      'api.host',
      'mongodb.url',
      'client.url',
      'app.dirs.uploads',
      'jwt.secret',
      'jwt.expiresIn'
    ]
    for (const key of required) {
      if (!pkg.has(key)) throw new Error(`Missing config: ${key}`)
    }
    if (this.get('jwt.secret') === 'CHANGE_ME_IN_LOCAL_JSON') {
      throw new Error('Imposta jwt.secret in config/local.json')
    }
  }

  get(key, defaultValue = undefined) {
    if (!pkg.has(key)) {
      if (defaultValue !== undefined) return defaultValue
      throw new Error(`Missing config: ${key}`)
    }
    return pkg.get(key)
  }
}