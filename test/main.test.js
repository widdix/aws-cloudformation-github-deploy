import { test, describe, beforeEach, mock } from 'node:test'
import assert from 'node:assert'
import * as path from 'path'
import { mockClient } from 'aws-sdk-client-mock'

// --- mocked @actions/core ---------------------------------------------------
const getInput = mock.fn()
const getMultilineInput = mock.fn()
const setOutput = mock.fn()
const setFailed = mock.fn()
const debug = mock.fn()
const error = mock.fn()

// --- mocked fs --------------------------------------------------------------
const readFileSync = mock.fn()
const access = mock.fn()

// --- @aws-sdk/client-cloudformation -----------------------------------------
// The CloudFormation client itself is mocked with aws-sdk-client-mock (below).
// The standalone waitUntil* helpers are NOT client methods, so we stub them
// here to avoid their real polling loops; everything else (client + commands)
// is re-exported untouched so aws-sdk-client-mock can patch the real client.
const waitUntilStackCreateComplete = mock.fn(() =>
  Promise.resolve({ state: 'SUCCESS' })
)
const waitUntilStackUpdateComplete = mock.fn(() =>
  Promise.resolve({ state: 'SUCCESS' })
)
const waitUntilChangeSetCreateComplete = mock.fn(() =>
  Promise.resolve({ state: 'SUCCESS' })
)

const realSdk = await import('@aws-sdk/client-cloudformation')
const {
  CloudFormationClient,
  CreateStackCommand,
  CreateChangeSetCommand,
  DescribeChangeSetCommand,
  DeleteChangeSetCommand,
  ExecuteChangeSetCommand,
  DescribeStacksCommand
} = realSdk

mock.module('@actions/core', {
  namedExports: {
    getInput,
    getMultilineInput,
    setOutput,
    setFailed,
    debug,
    error
  }
})
mock.module('@aws-sdk/client-cloudformation', {
  namedExports: {
    CloudFormationClient,
    CreateStackCommand,
    CreateChangeSetCommand,
    DescribeChangeSetCommand,
    DeleteChangeSetCommand,
    ExecuteChangeSetCommand,
    DescribeStacksCommand,
    waitUntilStackCreateComplete,
    waitUntilStackUpdateComplete,
    waitUntilChangeSetCreateComplete
  }
})
mock.module('fs', {
  namedExports: { readFileSync, promises: { access } }
})

const cfnMock = mockClient(CloudFormationClient)

// run() must be imported after the module mocks are registered.
const { run } = await import('../src/main.js')

const mockTemplate = `
AWSTemplateFormatVersion: "2010-09-09"
Metadata:
    LICENSE: MIT
Parameters:
    AdminEmail:
    Type: String
Resources:
    CFSNSSubscription:
    Type: AWS::SNS::Subscription
    Properties:
        Endpoint: !Ref AdminEmail
        Protocol: email
        TopicArn: !Ref CFSNSTopic
    CFSNSTopic:
    Type: AWS::SNS::Topic
Outputs:
    CFSNSTopicArn:
    Value: !Ref CFSNSTopic
`

const mockStackId =
  'arn:aws:cloudformation:us-east-1:123456789012:stack/myteststack/466df9e0-0dff-08e3-8e2f-5088487c4896'

// --- helpers ----------------------------------------------------------------
const baseStack = (overrides = {}) => ({
  StackId: mockStackId,
  Tags: [],
  Outputs: [],
  StackStatusReason: '',
  CreationTime: new Date('2013-08-23T01:02:15.422Z'),
  Capabilities: [],
  StackName: 'MockStack',
  StackStatus: 'CREATE_COMPLETE',
  ...overrides
})

const failedChangeSet = (statusReason = null) => ({
  Changes: [],
  ChangeSetName: 'MockStack-CS',
  ChangeSetId:
    'arn:aws:cloudformation:us-west-2:123456789012:changeSet/my-change-set/4eca1a01-e285-xmpl-8026-9a1967bfb4b0',
  StackId: mockStackId,
  StackName: 'MockStack',
  Description: null,
  Parameters: null,
  CreationTime: '2019-10-02T05:20:56.651Z',
  ExecutionStatus: 'AVAILABLE',
  Status: 'FAILED',
  StatusReason: statusReason,
  NotificationARNs: [],
  RollbackConfiguration: {},
  Capabilities: ['CAPABILITY_IAM'],
  Tags: null
})

const stackDoesNotExistError = () =>
  Object.assign(new Error('The stack does not exist.'), {
    name: 'ValidationError'
  })

// Recursively drop undefined-valued keys, mirroring jest's toEqual semantics
// (which the original assertions relied on) instead of strict deep equality.
function prune(value) {
  if (Array.isArray(value)) return value.map(prune)
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {}
    for (const key of Object.keys(value)) {
      if (value[key] !== undefined) out[key] = prune(value[key])
    }
    return out
  }
  return value
}

// Assertions for the node:test mock.fn() mocks (core + waiters).
const calledTimes = (mockFn, n) =>
  assert.strictEqual(mockFn.mock.callCount(), n)
const nthCalledWith = (mockFn, n, ...args) =>
  assert.deepStrictEqual(prune(mockFn.mock.calls[n - 1].arguments), prune(args))
const called = mockFn => assert.ok(mockFn.mock.callCount() > 0)

// Assertions for the aws-sdk-client-mock CloudFormation commands.
const receivedTimes = (Command, n) =>
  assert.strictEqual(cfnMock.commandCalls(Command).length, n)
const nthReceivedWith = (Command, n, expected) =>
  assert.deepStrictEqual(
    prune(cfnMock.commandCalls(Command)[n - 1].args[0].input),
    prune(expected)
  )

const resetMocks = [
  getInput,
  getMultilineInput,
  setOutput,
  setFailed,
  debug,
  error,
  waitUntilStackCreateComplete,
  waitUntilStackUpdateComplete,
  waitUntilChangeSetCreateComplete,
  readFileSync,
  access
]

describe('Deploy CloudFormation Stack', () => {
  beforeEach(() => {
    resetMocks.forEach(m => m.mock.resetCalls())

    cfnMock.reset()
    cfnMock.on(CreateStackCommand).resolves({ StackId: mockStackId })
    cfnMock.on(CreateChangeSetCommand).resolves({})
    cfnMock.on(DescribeChangeSetCommand).resolves({})
    cfnMock.on(DeleteChangeSetCommand).resolves({})
    cfnMock.on(ExecuteChangeSetCommand).resolves({})
    // First describeStacks reports the stack does not exist (create path),
    // subsequent calls return the created stack.
    cfnMock
      .on(DescribeStacksCommand)
      .rejectsOnce(stackDoesNotExistError())
      .resolves({ Stacks: [baseStack()] })

    const inputs = {
      name: 'MockStack',
      template: 'template.yaml',
      capabilities: 'CAPABILITY_IAM',
      'parameter-overrides': 'AdminEmail=no-reply@amazon.com',
      'no-fail-on-empty-changeset': '0',
      'disable-rollback': '0',
      'timeout-in-minutes': '',
      'notification-arns': '',
      'role-arn': '',
      tags: '',
      'termination-protection': ''
    }

    getInput.mock.mockImplementation(name => inputs[name])

    process.env = Object.assign(process.env, {
      GITHUB_WORKSPACE: import.meta.dirname
    })

    readFileSync.mock.mockImplementation((pathInput, encoding) => {
      const { GITHUB_WORKSPACE = '' } = process.env

      if (encoding != 'utf8') {
        throw new Error(`Wrong encoding ${encoding}`)
      }

      if (pathInput == path.join(GITHUB_WORKSPACE, 'template.yaml')) {
        return mockTemplate
      }

      throw new Error(`Unknown path ${pathInput}`)
    })

    waitUntilStackCreateComplete.mock.mockImplementation(() =>
      Promise.resolve({ state: 'SUCCESS' })
    )
    waitUntilStackUpdateComplete.mock.mockImplementation(() =>
      Promise.resolve({ state: 'SUCCESS' })
    )
    waitUntilChangeSetCreateComplete.mock.mockImplementation(() =>
      Promise.resolve({ state: 'SUCCESS' })
    )
  })

  test('deploys the stack with template', async () => {
    await run()

    calledTimes(setFailed, 0)
    receivedTimes(DescribeStacksCommand, 2)
    nthReceivedWith(DescribeStacksCommand, 1, { StackName: 'MockStack' })
    nthReceivedWith(DescribeStacksCommand, 2, { StackName: mockStackId })
    nthReceivedWith(CreateStackCommand, 1, {
      StackName: 'MockStack',
      TemplateBody: mockTemplate,
      Capabilities: ['CAPABILITY_IAM'],
      Parameters: [
        { ParameterKey: 'AdminEmail', ParameterValue: 'no-reply@amazon.com' }
      ],
      DisableRollback: false,
      EnableTerminationProtection: false
    })
    calledTimes(setOutput, 1)
    nthCalledWith(setOutput, 1, 'MockStack_stack-id', mockStackId)
  })

  test('sets the stack outputs as action outputs', async () => {
    cfnMock
      .on(DescribeStacksCommand)
      .rejectsOnce(stackDoesNotExistError())
      .resolves({
        Stacks: [
          baseStack({
            Outputs: [
              { OutputKey: 'hello', OutputValue: 'world' },
              { OutputKey: 'foo', OutputValue: 'bar' }
            ]
          })
        ]
      })

    await run()

    calledTimes(setFailed, 0)
    receivedTimes(DescribeStacksCommand, 2)
    nthReceivedWith(DescribeStacksCommand, 1, { StackName: 'MockStack' })
    nthReceivedWith(DescribeStacksCommand, 2, { StackName: mockStackId })
    nthReceivedWith(CreateStackCommand, 1, {
      StackName: 'MockStack',
      TemplateBody: mockTemplate,
      Capabilities: ['CAPABILITY_IAM'],
      Parameters: [
        { ParameterKey: 'AdminEmail', ParameterValue: 'no-reply@amazon.com' }
      ],
      DisableRollback: false,
      EnableTerminationProtection: false
    })
    calledTimes(setOutput, 3)
    nthCalledWith(setOutput, 1, 'MockStack_stack-id', mockStackId)
    nthCalledWith(setOutput, 2, 'MockStack_output_hello', 'world')
    nthCalledWith(setOutput, 3, 'MockStack_output_foo', 'bar')
  })

  test('deploys the stack with template url', async () => {
    const inputs = {
      name: 'MockStack',
      template:
        'https://s3.amazonaws.com/templates/myTemplate.template?versionId=123ab1cdeKdOW5IH4GAcYbEngcpTJTDW',
      capabilities: 'CAPABILITY_IAM',
      'parameter-overrides': 'AdminEmail=no-reply@amazon.com',
      'no-fail-on-empty-changeset': '1'
    }
    getInput.mock.mockImplementation(name => inputs[name])

    await run()

    calledTimes(setFailed, 0)
    receivedTimes(DescribeStacksCommand, 2)
    nthReceivedWith(DescribeStacksCommand, 1, { StackName: 'MockStack' })
    nthReceivedWith(DescribeStacksCommand, 2, { StackName: mockStackId })
    nthReceivedWith(CreateStackCommand, 1, {
      StackName: 'MockStack',
      TemplateURL:
        'https://s3.amazonaws.com/templates/myTemplate.template?versionId=123ab1cdeKdOW5IH4GAcYbEngcpTJTDW',
      TemplateBody: undefined,
      Capabilities: ['CAPABILITY_IAM'],
      Parameters: [
        { ParameterKey: 'AdminEmail', ParameterValue: 'no-reply@amazon.com' }
      ],
      DisableRollback: false,
      EnableTerminationProtection: false
    })
    calledTimes(setOutput, 1)
    nthCalledWith(setOutput, 1, 'MockStack_stack-id', mockStackId)
  })

  test('deploys the stack with termination protection', async () => {
    const inputs = {
      name: 'MockStack',
      template:
        'https://s3.amazonaws.com/templates/myTemplate.template?versionId=123ab1cdeKdOW5IH4GAcYbEngcpTJTDW',
      capabilities: 'CAPABILITY_IAM',
      'parameter-overrides': 'AdminEmail=no-reply@amazon.com',
      'no-fail-on-empty-changeset': '1',
      'termination-protection': '1'
    }
    getInput.mock.mockImplementation(name => inputs[name])

    await run()

    calledTimes(setFailed, 0)
    receivedTimes(DescribeStacksCommand, 2)
    nthReceivedWith(DescribeStacksCommand, 1, { StackName: 'MockStack' })
    nthReceivedWith(DescribeStacksCommand, 2, { StackName: mockStackId })
    nthReceivedWith(CreateStackCommand, 1, {
      StackName: 'MockStack',
      TemplateURL:
        'https://s3.amazonaws.com/templates/myTemplate.template?versionId=123ab1cdeKdOW5IH4GAcYbEngcpTJTDW',
      TemplateBody: undefined,
      Capabilities: ['CAPABILITY_IAM'],
      Parameters: [
        { ParameterKey: 'AdminEmail', ParameterValue: 'no-reply@amazon.com' }
      ],
      DisableRollback: false,
      EnableTerminationProtection: true
    })
    calledTimes(setOutput, 1)
    nthCalledWith(setOutput, 1, 'MockStack_stack-id', mockStackId)
  })

  test('deploys the stack with disabling rollback', async () => {
    const inputs = {
      name: 'MockStack',
      template:
        'https://s3.amazonaws.com/templates/myTemplate.template?versionId=123ab1cdeKdOW5IH4GAcYbEngcpTJTDW',
      capabilities: 'CAPABILITY_IAM',
      'parameter-overrides': 'AdminEmail=no-reply@amazon.com',
      'no-fail-on-empty-changeset': '1',
      'disable-rollback': '1'
    }
    getInput.mock.mockImplementation(name => inputs[name])

    await run()

    calledTimes(setFailed, 0)
    receivedTimes(DescribeStacksCommand, 2)
    nthReceivedWith(DescribeStacksCommand, 1, { StackName: 'MockStack' })
    nthReceivedWith(DescribeStacksCommand, 2, { StackName: mockStackId })
    nthReceivedWith(CreateStackCommand, 1, {
      StackName: 'MockStack',
      TemplateURL:
        'https://s3.amazonaws.com/templates/myTemplate.template?versionId=123ab1cdeKdOW5IH4GAcYbEngcpTJTDW',
      TemplateBody: undefined,
      Capabilities: ['CAPABILITY_IAM'],
      Parameters: [
        { ParameterKey: 'AdminEmail', ParameterValue: 'no-reply@amazon.com' }
      ],
      DisableRollback: true,
      EnableTerminationProtection: false
    })
    calledTimes(setOutput, 1)
    nthCalledWith(setOutput, 1, 'MockStack_stack-id', mockStackId)
  })

  test('deploys the stack with Notification ARNs', async () => {
    const inputs = {
      name: 'MockStack',
      template:
        'https://s3.amazonaws.com/templates/myTemplate.template?versionId=123ab1cdeKdOW5IH4GAcYbEngcpTJTDW',
      capabilities: 'CAPABILITY_IAM',
      'parameter-overrides': 'AdminEmail=no-reply@amazon.com',
      'no-fail-on-empty-changeset': '1',
      'notification-arns':
        'arn:aws:sns:us-east-2:123456789012:MyTopic,arn:aws:sns:us-east-2:123456789012:MyTopic2'
    }
    getInput.mock.mockImplementation(name => inputs[name])

    await run()

    calledTimes(setFailed, 0)
    receivedTimes(DescribeStacksCommand, 2)
    nthReceivedWith(DescribeStacksCommand, 1, { StackName: 'MockStack' })
    nthReceivedWith(DescribeStacksCommand, 2, { StackName: mockStackId })
    nthReceivedWith(CreateStackCommand, 1, {
      StackName: 'MockStack',
      TemplateURL:
        'https://s3.amazonaws.com/templates/myTemplate.template?versionId=123ab1cdeKdOW5IH4GAcYbEngcpTJTDW',
      TemplateBody: undefined,
      Capabilities: ['CAPABILITY_IAM'],
      Parameters: [
        { ParameterKey: 'AdminEmail', ParameterValue: 'no-reply@amazon.com' }
      ],
      NotificationARNs: [
        'arn:aws:sns:us-east-2:123456789012:MyTopic',
        'arn:aws:sns:us-east-2:123456789012:MyTopic2'
      ],
      DisableRollback: false,
      EnableTerminationProtection: false
    })
    calledTimes(setOutput, 1)
    nthCalledWith(setOutput, 1, 'MockStack_stack-id', mockStackId)
  })

  test('deploys the stack with Role ARN', async () => {
    const inputs = {
      name: 'MockStack',
      template:
        'https://s3.amazonaws.com/templates/myTemplate.template?versionId=123ab1cdeKdOW5IH4GAcYbEngcpTJTDW',
      capabilities: 'CAPABILITY_IAM',
      'parameter-overrides': 'AdminEmail=no-reply@amazon.com',
      'no-fail-on-empty-changeset': '1',
      'role-arn': 'arn:aws:iam::123456789012:role/my-role'
    }
    getInput.mock.mockImplementation(name => inputs[name])

    await run()

    calledTimes(setFailed, 0)
    receivedTimes(DescribeStacksCommand, 2)
    nthReceivedWith(DescribeStacksCommand, 1, { StackName: 'MockStack' })
    nthReceivedWith(DescribeStacksCommand, 2, { StackName: mockStackId })
    nthReceivedWith(CreateStackCommand, 1, {
      StackName: 'MockStack',
      TemplateURL:
        'https://s3.amazonaws.com/templates/myTemplate.template?versionId=123ab1cdeKdOW5IH4GAcYbEngcpTJTDW',
      TemplateBody: undefined,
      Capabilities: ['CAPABILITY_IAM'],
      Parameters: [
        { ParameterKey: 'AdminEmail', ParameterValue: 'no-reply@amazon.com' }
      ],
      RoleARN: 'arn:aws:iam::123456789012:role/my-role',
      DisableRollback: false,
      EnableTerminationProtection: false
    })
    calledTimes(setOutput, 1)
    nthCalledWith(setOutput, 1, 'MockStack_stack-id', mockStackId)
  })

  test('deploys the stack with tags', async () => {
    const inputs = {
      name: 'MockStack',
      template:
        'https://s3.amazonaws.com/templates/myTemplate.template?versionId=123ab1cdeKdOW5IH4GAcYbEngcpTJTDW',
      capabilities: 'CAPABILITY_IAM',
      'parameter-overrides': 'AdminEmail=no-reply@amazon.com',
      'no-fail-on-empty-changeset': '1',
      tags: '[{"Key":"Test","Value":"Value"}]'
    }
    getInput.mock.mockImplementation(name => inputs[name])

    await run()

    calledTimes(setFailed, 0)
    receivedTimes(DescribeStacksCommand, 2)
    nthReceivedWith(DescribeStacksCommand, 1, { StackName: 'MockStack' })
    nthReceivedWith(DescribeStacksCommand, 2, { StackName: mockStackId })
    nthReceivedWith(CreateStackCommand, 1, {
      StackName: 'MockStack',
      TemplateURL:
        'https://s3.amazonaws.com/templates/myTemplate.template?versionId=123ab1cdeKdOW5IH4GAcYbEngcpTJTDW',
      TemplateBody: undefined,
      Capabilities: ['CAPABILITY_IAM'],
      Parameters: [
        { ParameterKey: 'AdminEmail', ParameterValue: 'no-reply@amazon.com' }
      ],
      Tags: [{ Key: 'Test', Value: 'Value' }],
      DisableRollback: false,
      EnableTerminationProtection: false
    })
    calledTimes(setOutput, 1)
    nthCalledWith(setOutput, 1, 'MockStack_stack-id', mockStackId)
  })

  test('deploys the stack with timeout', async () => {
    const inputs = {
      name: 'MockStack',
      template:
        'https://s3.amazonaws.com/templates/myTemplate.template?versionId=123ab1cdeKdOW5IH4GAcYbEngcpTJTDW',
      capabilities: 'CAPABILITY_IAM',
      'parameter-overrides': 'AdminEmail=no-reply@amazon.com',
      'no-fail-on-empty-changeset': '1',
      'timeout-in-minutes': '10'
    }
    getInput.mock.mockImplementation(name => inputs[name])

    await run()

    calledTimes(setFailed, 0)
    receivedTimes(DescribeStacksCommand, 2)
    nthReceivedWith(DescribeStacksCommand, 1, { StackName: 'MockStack' })
    nthReceivedWith(DescribeStacksCommand, 2, { StackName: mockStackId })
    nthReceivedWith(CreateStackCommand, 1, {
      StackName: 'MockStack',
      TemplateURL:
        'https://s3.amazonaws.com/templates/myTemplate.template?versionId=123ab1cdeKdOW5IH4GAcYbEngcpTJTDW',
      TemplateBody: undefined,
      Capabilities: ['CAPABILITY_IAM'],
      Parameters: [
        { ParameterKey: 'AdminEmail', ParameterValue: 'no-reply@amazon.com' }
      ],
      TimeoutInMinutes: 10,
      DisableRollback: false,
      EnableTerminationProtection: false
    })
    calledTimes(setOutput, 1)
    nthCalledWith(setOutput, 1, 'MockStack_stack-id', mockStackId)
  })

  test('deploys multiple stacks', async () => {
    const inputs = {
      name: 'MockStack\nMockStack2',
      template:
        'https://s3.amazonaws.com/templates/myTemplate.template?versionId=123ab1cdeKdOW5IH4GAcYbEngcpTJTDW\nhttps://s3.amazonaws.com/templates/myTemplate.template?versionId=123ab1cdeKdOW5IH4GAcYbEngcpTJTDW2',
      capabilities: 'CAPABILITY_IAM',
      'parameter-overrides': 'AdminEmail=no-reply@amazon.com\n',
      'no-fail-on-empty-changeset': '1',
      concurrency: '1' // run order is not predictable/testable for values > 1
    }
    getInput.mock.mockImplementation(name => inputs[name])

    cfnMock
      .on(DescribeStacksCommand)
      .rejectsOnce(stackDoesNotExistError())
      .resolvesOnce({ Stacks: [baseStack()] })
      .rejectsOnce(stackDoesNotExistError())
      .resolves({ Stacks: [baseStack({ StackName: 'MockStack2' })] })

    await run()

    calledTimes(setFailed, 0)
    receivedTimes(DescribeStacksCommand, 4)
    nthReceivedWith(DescribeStacksCommand, 1, { StackName: 'MockStack' })
    nthReceivedWith(DescribeStacksCommand, 2, { StackName: mockStackId })
    nthReceivedWith(DescribeStacksCommand, 3, { StackName: 'MockStack2' })
    nthReceivedWith(DescribeStacksCommand, 4, { StackName: mockStackId })
    receivedTimes(CreateStackCommand, 2)
    nthReceivedWith(CreateStackCommand, 1, {
      StackName: 'MockStack',
      TemplateURL:
        'https://s3.amazonaws.com/templates/myTemplate.template?versionId=123ab1cdeKdOW5IH4GAcYbEngcpTJTDW',
      TemplateBody: undefined,
      Capabilities: ['CAPABILITY_IAM'],
      Parameters: [
        { ParameterKey: 'AdminEmail', ParameterValue: 'no-reply@amazon.com' }
      ],
      DisableRollback: false,
      EnableTerminationProtection: false
    })
    nthReceivedWith(CreateStackCommand, 2, {
      StackName: 'MockStack2',
      TemplateURL:
        'https://s3.amazonaws.com/templates/myTemplate.template?versionId=123ab1cdeKdOW5IH4GAcYbEngcpTJTDW2',
      TemplateBody: undefined,
      Capabilities: ['CAPABILITY_IAM'],
      DisableRollback: false,
      EnableTerminationProtection: false
    })
    calledTimes(setOutput, 2)
    nthCalledWith(setOutput, 1, 'MockStack_stack-id', mockStackId)
    nthCalledWith(setOutput, 2, 'MockStack2_stack-id', mockStackId)
  })

  test('successfully update the stack', async () => {
    cfnMock.on(DescribeStacksCommand).resolves({ Stacks: [baseStack()] })

    await run()

    calledTimes(setFailed, 0)
    receivedTimes(DescribeStacksCommand, 2)
    nthReceivedWith(DescribeStacksCommand, 1, { StackName: 'MockStack' })
    nthReceivedWith(DescribeStacksCommand, 2, { StackName: mockStackId })
    receivedTimes(CreateStackCommand, 0)
    nthReceivedWith(CreateChangeSetCommand, 1, {
      StackName: 'MockStack',
      TemplateBody: mockTemplate,
      Capabilities: ['CAPABILITY_IAM'],
      Parameters: [
        { ParameterKey: 'AdminEmail', ParameterValue: 'no-reply@amazon.com' }
      ],
      ChangeSetName: 'MockStack-CS',
      ResourceType: undefined,
      RollbackConfiguration: undefined,
      NotificationARNs: undefined,
      RoleARN: undefined,
      Tags: undefined,
      TemplateURL: undefined,
      TimeoutInMinutes: undefined
    })
    nthReceivedWith(ExecuteChangeSetCommand, 1, {
      ChangeSetName: 'MockStack-CS',
      StackName: 'MockStack'
    })
    calledTimes(waitUntilChangeSetCreateComplete, 1)
    calledTimes(waitUntilStackUpdateComplete, 1)
  })

  test('no execute change set on update the stack', async () => {
    const inputs = {
      name: 'MockStack',
      template: 'template.yaml',
      capabilities: 'CAPABILITY_IAM',
      'parameter-overrides': 'AdminEmail=no-reply@amazon.com',
      'no-execute-changeset': '1'
    }
    getInput.mock.mockImplementation(name => inputs[name])

    cfnMock.on(DescribeStacksCommand).resolves({ Stacks: [baseStack()] })

    await run()

    calledTimes(setFailed, 0)
    receivedTimes(DescribeStacksCommand, 2)
    nthReceivedWith(DescribeStacksCommand, 1, { StackName: 'MockStack' })
    nthReceivedWith(DescribeStacksCommand, 2, { StackName: mockStackId })
    receivedTimes(CreateStackCommand, 0)
    nthReceivedWith(CreateChangeSetCommand, 1, {
      StackName: 'MockStack',
      TemplateBody: mockTemplate,
      Capabilities: ['CAPABILITY_IAM'],
      Parameters: [
        { ParameterKey: 'AdminEmail', ParameterValue: 'no-reply@amazon.com' }
      ],
      ChangeSetName: 'MockStack-CS',
      ResourceType: undefined,
      RollbackConfiguration: undefined,
      NotificationARNs: undefined,
      RoleARN: undefined,
      Tags: undefined,
      TemplateURL: undefined,
      TimeoutInMinutes: undefined
    })
    receivedTimes(ExecuteChangeSetCommand, 0)
    calledTimes(waitUntilChangeSetCreateComplete, 1)
    calledTimes(waitUntilStackUpdateComplete, 0)
  })

  test('error is caught updating if create change fails', async () => {
    cfnMock
      .on(DescribeStacksCommand)
      .resolves({ Stacks: [baseStack({ DisableRollback: false })] })
    cfnMock.on(DescribeChangeSetCommand).resolves(failedChangeSet(null))
    waitUntilChangeSetCreateComplete.mock.mockImplementation(() =>
      Promise.reject(new Error('change set failed'))
    )

    await run()

    calledTimes(setFailed, 1)
    receivedTimes(DescribeStacksCommand, 1)
    nthReceivedWith(DescribeStacksCommand, 1, { StackName: 'MockStack' })
    receivedTimes(CreateStackCommand, 0)
    nthReceivedWith(CreateChangeSetCommand, 1, {
      StackName: 'MockStack',
      TemplateBody: mockTemplate,
      Capabilities: ['CAPABILITY_IAM'],
      Parameters: [
        { ParameterKey: 'AdminEmail', ParameterValue: 'no-reply@amazon.com' }
      ],
      ChangeSetName: 'MockStack-CS',
      ResourceTypes: undefined,
      RollbackConfiguration: undefined,
      NotificationARNs: undefined,
      RoleARN: undefined,
      Tags: undefined,
      TemplateURL: undefined,
      TimeoutInMinutes: undefined
    })
    nthReceivedWith(DeleteChangeSetCommand, 1, {
      ChangeSetName: 'MockStack-CS',
      StackName: 'MockStack'
    })
    receivedTimes(ExecuteChangeSetCommand, 0)
  })

  test('no error if updating fails with empty change set', async () => {
    const inputs = {
      name: 'MockStack',
      template: 'template.yaml',
      capabilities: 'CAPABILITY_IAM',
      'parameter-overrides': 'AdminEmail=no-reply@amazon.com',
      'no-fail-on-empty-changeset': '1'
    }
    getInput.mock.mockImplementation(name => inputs[name])

    cfnMock.on(DescribeStacksCommand).resolves({
      Stacks: [
        baseStack({
          StackStatusReason: `The submitted information didn't contain changes`,
          StackStatus: 'FAILED',
          DisableRollback: false
        })
      ]
    })
    waitUntilChangeSetCreateComplete.mock.mockImplementation(() =>
      Promise.reject(new Error('change set failed'))
    )
    cfnMock
      .on(DescribeChangeSetCommand)
      .resolves(
        failedChangeSet(
          "The submitted information didn't contain changes. Submit different information to create a change set."
        )
      )

    await run()

    calledTimes(setFailed, 0)
    calledTimes(setOutput, 1)
    receivedTimes(DescribeStacksCommand, 2)
    nthReceivedWith(DescribeStacksCommand, 1, { StackName: 'MockStack' })
    nthReceivedWith(DescribeStacksCommand, 2, { StackName: mockStackId })
    receivedTimes(CreateStackCommand, 0)
    nthReceivedWith(CreateChangeSetCommand, 1, {
      StackName: 'MockStack',
      TemplateBody: mockTemplate,
      Capabilities: ['CAPABILITY_IAM'],
      Parameters: [
        { ParameterKey: 'AdminEmail', ParameterValue: 'no-reply@amazon.com' }
      ],
      ChangeSetName: 'MockStack-CS',
      NotificationARNs: undefined,
      ResourceTypes: undefined,
      RollbackConfiguration: undefined,
      RoleARN: undefined,
      Tags: undefined,
      TemplateURL: undefined,
      TimeoutInMinutes: undefined
    })
    nthReceivedWith(DeleteChangeSetCommand, 1, {
      ChangeSetName: 'MockStack-CS',
      StackName: 'MockStack'
    })
    receivedTimes(ExecuteChangeSetCommand, 0)
  })

  test('no deleting change set if change set is empty', async () => {
    const inputs = {
      name: 'MockStack',
      template: 'template.yaml',
      capabilities: 'CAPABILITY_IAM',
      'parameter-overrides': 'AdminEmail=no-reply@amazon.com',
      'no-fail-on-empty-changeset': '1',
      'no-delete-failed-changeset': '1'
    }
    getInput.mock.mockImplementation(name => inputs[name])

    cfnMock.on(DescribeStacksCommand).resolves({
      Stacks: [
        baseStack({
          StackStatusReason: `The submitted information didn't contain changes`,
          StackStatus: 'FAILED',
          DisableRollback: false
        })
      ]
    })
    waitUntilChangeSetCreateComplete.mock.mockImplementation(() =>
      Promise.reject(new Error('change set failed'))
    )
    cfnMock
      .on(DescribeChangeSetCommand)
      .resolves(
        failedChangeSet(
          "The submitted information didn't contain changes. Submit different information to create a change set."
        )
      )

    await run()

    calledTimes(setFailed, 0)
    calledTimes(setOutput, 1)
    receivedTimes(DescribeStacksCommand, 2)
    nthReceivedWith(DescribeStacksCommand, 1, { StackName: 'MockStack' })
    nthReceivedWith(DescribeStacksCommand, 2, { StackName: mockStackId })
    receivedTimes(CreateStackCommand, 0)
    nthReceivedWith(CreateChangeSetCommand, 1, {
      StackName: 'MockStack',
      TemplateBody: mockTemplate,
      Capabilities: ['CAPABILITY_IAM'],
      Parameters: [
        { ParameterKey: 'AdminEmail', ParameterValue: 'no-reply@amazon.com' }
      ],
      ChangeSetName: 'MockStack-CS',
      NotificationARNs: undefined,
      ResourceTypes: undefined,
      RollbackConfiguration: undefined,
      RoleARN: undefined,
      Tags: undefined,
      TemplateURL: undefined,
      TimeoutInMinutes: undefined
    })
    receivedTimes(DeleteChangeSetCommand, 0)
    receivedTimes(ExecuteChangeSetCommand, 0)
  })

  test('change set is not deleted if creating change set fails', async () => {
    const inputs = {
      name: 'MockStack',
      template: 'template.yaml',
      capabilities: 'CAPABILITY_IAM',
      'parameter-overrides': 'AdminEmail=no-reply@amazon.com',
      'no-delete-failed-changeset': '1'
    }
    getInput.mock.mockImplementation(name => inputs[name])

    cfnMock
      .on(DescribeStacksCommand)
      .resolves({ Stacks: [baseStack({ DisableRollback: false })] })
    cfnMock.on(DescribeChangeSetCommand).resolves(failedChangeSet(null))
    waitUntilChangeSetCreateComplete.mock.mockImplementation(() =>
      Promise.reject(new Error('change set failed'))
    )

    await run()

    calledTimes(setFailed, 1)
    receivedTimes(DescribeStacksCommand, 1)
    nthReceivedWith(DescribeStacksCommand, 1, { StackName: 'MockStack' })
    receivedTimes(CreateStackCommand, 0)
    nthReceivedWith(CreateChangeSetCommand, 1, {
      StackName: 'MockStack',
      TemplateBody: mockTemplate,
      Capabilities: ['CAPABILITY_IAM'],
      Parameters: [
        { ParameterKey: 'AdminEmail', ParameterValue: 'no-reply@amazon.com' }
      ],
      ChangeSetName: 'MockStack-CS',
      ResourceTypes: undefined,
      RollbackConfiguration: undefined,
      NotificationARNs: undefined,
      RoleARN: undefined,
      Tags: undefined,
      TemplateURL: undefined,
      TimeoutInMinutes: undefined
    })
    receivedTimes(DeleteChangeSetCommand, 0)
    receivedTimes(ExecuteChangeSetCommand, 0)
  })

  test('no error if updating fails with no updates to be performed', async () => {
    const inputs = {
      name: 'MockStack',
      template: 'template.yaml',
      capabilities: 'CAPABILITY_IAM',
      'parameter-overrides': 'AdminEmail=no-reply@amazon.com',
      'no-fail-on-empty-changeset': '1'
    }
    getInput.mock.mockImplementation(name => inputs[name])

    cfnMock.on(DescribeStacksCommand).resolves({
      Stacks: [
        baseStack({ StackStatus: 'UPDATE_COMPLETE', DisableRollback: false })
      ]
    })
    waitUntilChangeSetCreateComplete.mock.mockImplementation(() =>
      Promise.reject(new Error('change set failed'))
    )
    cfnMock
      .on(DescribeChangeSetCommand)
      .resolves(failedChangeSet('No updates are to be performed'))

    await run()

    calledTimes(setFailed, 0)
    calledTimes(setOutput, 1)
    receivedTimes(DescribeStacksCommand, 2)
    nthReceivedWith(DescribeStacksCommand, 1, { StackName: 'MockStack' })
    nthReceivedWith(DescribeStacksCommand, 2, { StackName: mockStackId })
    receivedTimes(CreateStackCommand, 0)
    nthReceivedWith(CreateChangeSetCommand, 1, {
      StackName: 'MockStack',
      TemplateBody: mockTemplate,
      Capabilities: ['CAPABILITY_IAM'],
      Parameters: [
        { ParameterKey: 'AdminEmail', ParameterValue: 'no-reply@amazon.com' }
      ],
      ChangeSetName: 'MockStack-CS',
      NotificationARNs: undefined,
      ResourceTypes: undefined,
      RollbackConfiguration: undefined,
      RoleARN: undefined,
      Tags: undefined,
      TemplateURL: undefined,
      TimeoutInMinutes: undefined
    })
    nthReceivedWith(DeleteChangeSetCommand, 1, {
      ChangeSetName: 'MockStack-CS',
      StackName: 'MockStack'
    })
    receivedTimes(ExecuteChangeSetCommand, 0)
  })

  test('error is caught by core.setFailed', async () => {
    cfnMock.on(DescribeStacksCommand).rejects(new Error())

    await run()

    called(setFailed)
  })
})
