import * as fs from 'fs'

export function isUrl(s) {
  let url

  try {
    url = new URL(s)
  } catch {
    return false
  }

  return url.protocol === 'https:'
}

export function parseTags(s) {
  let json

  try {
    json = JSON.parse(s)
  } catch {}

  return json
}

export function parseARNs(s) {
  return s?.length > 0 ? s.split(',') : undefined
}

export function parseString(s) {
  return s?.length > 0 ? s : undefined
}

export function parseNumber(s) {
  return parseInt(s) || undefined
}

export function parseParameters(parameterOverrides) {
  if (parameterOverrides.startsWith('file://')) {
    const path = new URL(parameterOverrides)
    const rawParameters = fs.readFileSync(path, 'utf-8')
    return JSON.parse(rawParameters)
  } else {
    const parameters = new Map()
    parameterOverrides.split(',').forEach(parameter => {
      const [key, value] = parameter.trim().split('=')
      let param = parameters.get(key)
      param = !param ? value : [param, value].join(',')
      parameters.set(key, param)
    })

    return [...parameters.keys()].map(key => {
      return {
        ParameterKey: key,
        ParameterValue: parameters.get(key)
      }
    })
  }
}
