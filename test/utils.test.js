import { test, describe } from 'node:test'
import assert from 'node:assert'
import * as path from 'path'
import { parseTags, isUrl, parseParameters } from '../src/utils.js'

describe('Determine a valid url', () => {
  test('returns true on a valid url', () => {
    assert.ok(
      isUrl(
        'https://s3.amazonaws.com/templates/myTemplate.template?versionId=123ab1cdeKdOW5IH4GAcYbEngcpTJTDW'
      )
    )
  })

  test('returns false on path', () => {
    assert.ok(!isUrl('./template.json'))
  })
})

describe('Parse Tags', () => {
  test('returns undefined on non valid JSON', () => {
    assert.strictEqual(parseTags(''), undefined)
  })

  test('returns valid Array on valid JSON', () => {
    const json = parseTags(JSON.stringify([{ Key: 'Test', Value: 'Value' }]))
    assert.deepStrictEqual(json, [{ Key: 'Test', Value: 'Value' }])
  })
})

describe('Parse Parameters', () => {
  test('returns parameters list from string', () => {
    const json = parseParameters('MyParam1=myValue1,MyParam2=myValue2')
    assert.deepStrictEqual(json, [
      {
        ParameterKey: 'MyParam1',
        ParameterValue: 'myValue1'
      },
      {
        ParameterKey: 'MyParam2',
        ParameterValue: 'myValue2'
      }
    ])
  })

  test('returns parameters list from string with repeated key', () => {
    const json = parseParameters(
      'MyParam1=myValue1,MyParam2=myValue2,MyParam2=myValue3'
    )
    assert.deepStrictEqual(json, [
      {
        ParameterKey: 'MyParam1',
        ParameterValue: 'myValue1'
      },
      {
        ParameterKey: 'MyParam2',
        ParameterValue: 'myValue2,myValue3'
      }
    ])
  })

  test('returns parameters list from file', () => {
    const filename =
      'file://' + path.join(import.meta.dirname, 'params.test.json')
    const json = parseParameters(filename)
    assert.deepStrictEqual(json, [
      {
        ParameterKey: 'MyParam1',
        ParameterValue: 'myValue1'
      },
      {
        ParameterKey: 'MyParam2',
        ParameterValue: 'myValue2'
      }
    ])
  })

  test('throws error if file is not found', () => {
    const filename =
      'file://' + path.join(import.meta.dirname, 'params.tezt.json')
    assert.throws(() => parseParameters(filename))
  })

  test('throws error if json in file cannot be parsed', () => {
    const filename =
      'file://' + path.join(import.meta.dirname, 'params-invalid.test.json')
    assert.throws(() => parseParameters(filename))
  })
})
