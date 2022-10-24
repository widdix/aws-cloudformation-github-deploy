import pLimit from 'p-limit'
import * as path from 'path'
import * as core from '@actions/core'
import * as aws from 'aws-sdk'
import * as fs from 'fs'
import { deployStack, getStackOutputs } from './deploy'
import {
  isUrl,
  parseTags,
  parseString,
  parseNumber,
  parseARNs,
  parseParameters
} from './utils'

export type CreateStackInput = aws.CloudFormation.Types.CreateStackInput
export type CreateChangeSetInput = aws.CloudFormation.Types.CreateChangeSetInput
export type InputNoFailOnEmptyChanges = '1' | '0'
export type InputCapabilities =
  | 'CAPABILITY_IAM'
  | 'CAPABILITY_NAMED_IAM'
  | 'CAPABILITY_AUTO_EXPAND'

export type Inputs = {
  [key: string]: string
}

// The custom client configuration for the CloudFormation clients.
const clientConfiguration = {
  customUserAgent: 'aws-cloudformation-github-deploy-for-github-actions'
}

export async function task(
  cfn: aws.CloudFormation,
  options: {
    template: string
    stackName: string
    capabilities?: string
    roleARN?: string
    notificationARNs?: string[]
    disableRollback?: boolean
    timeoutInMinutes?: number
    tags?: aws.CloudFormation.Tags
    terminationProtection?: boolean
    parameterOverrides?: string
    noEmptyChangeSet?: boolean
    noExecuteChangeSet?: boolean
    noDeleteFailedChangeSet?: boolean
  }
): Promise<void> {
  const { GITHUB_WORKSPACE = __dirname } = process.env
  // Setup CloudFormation Stack
  let templateBody
  let templateUrl

  if (isUrl(options.template)) {
    core.debug(
      `${options.stackName}: Using CloudFormation Stack from Amazon S3 Bucket`
    )
    templateUrl = options.template
  } else {
    core.debug(`${options.stackName}: Loading CloudFormation Stack template`)
    const templateFilePath = path.isAbsolute(options.template)
      ? options.template
      : path.join(GITHUB_WORKSPACE, options.template)
    templateBody = fs.readFileSync(templateFilePath, 'utf8')
  }

  // CloudFormation Stack Parameter for the creation or update
  const params: CreateStackInput = {
    StackName: options.stackName,
    ...(options.roleARN !== undefined && { RoleARN: options.roleARN }),
    ...(options.notificationARNs !== undefined && {
      NotificationARNs: options.notificationARNs
    }),
    DisableRollback: options.disableRollback,
    ...(options.timeoutInMinutes !== undefined && {
      TimeoutInMinutes: options.timeoutInMinutes
    }),
    TemplateBody: templateBody,
    TemplateURL: templateUrl,
    ...(options.tags !== undefined && { Tags: options.tags }),
    EnableTerminationProtection: options.terminationProtection
  }

  if (options.capabilities) {
    params.Capabilities = [
      ...options.capabilities.split(',').map(cap => cap.trim())
    ]
  }

  if (options.parameterOverrides) {
    params.Parameters = parseParameters(options.parameterOverrides.trim())
  }

  const stackId = await deployStack(
    cfn,
    params,
    options.noEmptyChangeSet,
    options.noExecuteChangeSet,
    options.noDeleteFailedChangeSet
  )
  core.setOutput(`${options.stackName}_stack-id`, stackId || 'UNKNOWN')

  if (stackId) {
    const outputs = await getStackOutputs(cfn, stackId)
    for (const [logicalId, value] of outputs) {
      core.setOutput(`${options.stackName}_output_${logicalId}`, value)
    }
  }
}

function pickOption<Type>(arr: Type[], i: number): Type | undefined {
  if (arr.length === 0) {
    return undefined
  }
  if (arr.length === 1) {
    return arr[0]
  }
  return arr[i]
}

// we don't use core.getMultilineInput() because it filters out empty lines
function parseMultiline(str: string): string[] {
  if (str === undefined) {
    // some tests pass undefined instead of an empty string as core.getInput() would do
    return ['']
  }
  return str.split('\n')
}

export async function run(): Promise<void> {
  try {
    const cfn = new aws.CloudFormation({ ...clientConfiguration })

    // Get inputs
    const template = parseMultiline(
      core.getInput('template', { required: true })
    )
    const stackName = parseMultiline(core.getInput('name', { required: true }))
    const capabilities = parseMultiline(
      core.getInput('capabilities', {
        required: false
      })
    )
    const parameterOverrides = parseMultiline(
      core.getInput('parameter-overrides', {
        required: false
      })
    )
    const noEmptyChangeSet = parseMultiline(
      core.getInput('no-fail-on-empty-changeset', {
        required: false
      })
    ).map(x => !!+x)
    const noExecuteChangeSet = parseMultiline(
      core.getInput('no-execute-changeset', {
        required: false
      })
    ).map(x => !!+x)
    const noDeleteFailedChangeSet = parseMultiline(
      core.getInput('no-delete-failed-changeset', {
        required: false
      })
    ).map(x => !!+x)
    const disableRollback = parseMultiline(
      core.getInput('disable-rollback', {
        required: false
      })
    ).map(x => !!+x)
    const timeoutInMinutes = parseMultiline(
      core.getInput('timeout-in-minutes', {
        required: false
      })
    ).map(parseNumber)
    const notificationARNs = parseMultiline(
      core.getInput('notification-arns', {
        required: false
      })
    ).map(parseARNs)
    const roleARN = parseMultiline(
      core.getInput('role-arn', {
        required: false
      })
    ).map(parseString)
    const tags = parseMultiline(
      core.getInput('tags', {
        required: false
      })
    ).map(parseTags)
    const terminationProtection = parseMultiline(
      core.getInput('termination-protection', {
        required: false
      })
    ).map(x => !!+x)

    if (template.length != stackName.length) {
      throw new Error('number of input lemplate lines must match name lines')
    }
    if (capabilities.length !== 1 && capabilities.length != stackName.length) {
      throw new Error(
        'number input capabilities lines must match name lines or must be a single line'
      )
    }
    if (
      parameterOverrides.length !== 1 &&
      parameterOverrides.length != stackName.length
    ) {
      throw new Error(
        'number input parameter-overrides lines must match name lines or must be a single line'
      )
    }
    if (
      noExecuteChangeSet.length !== 1 &&
      noExecuteChangeSet.length != stackName.length
    ) {
      throw new Error(
        'number input no-execute-changeset lines must match name lines or must be a single line'
      )
    }
    if (
      noDeleteFailedChangeSet.length !== 1 &&
      noDeleteFailedChangeSet.length != stackName.length
    ) {
      throw new Error(
        'number input no-delete-failed-changeset lines must match name lines or must be a single line'
      )
    }
    if (
      noEmptyChangeSet.length !== 1 &&
      noEmptyChangeSet.length != stackName.length
    ) {
      throw new Error(
        'number input no-fail-on-empty-changeset lines must match name lines or must be a single line'
      )
    }
    if (
      disableRollback.length !== 1 &&
      disableRollback.length != stackName.length
    ) {
      throw new Error(
        'number input disable-rollback lines must match name lines or must be a single line'
      )
    }
    if (
      timeoutInMinutes.length !== 1 &&
      timeoutInMinutes.length != stackName.length
    ) {
      throw new Error(
        'number input timeout-in-minutes lines must match name lines or must be a single line'
      )
    }
    if (
      notificationARNs.length !== 1 &&
      notificationARNs.length != stackName.length
    ) {
      throw new Error(
        'number input notification-arns lines must match name lines or must be a single line'
      )
    }
    if (roleARN.length !== 1 && roleARN.length != stackName.length) {
      throw new Error(
        'number input role-arn lines must match name lines or must be a single line'
      )
    }
    if (tags.length !== 1 && tags.length != stackName.length) {
      throw new Error(
        'number input tags lines must match name lines or must be a single line'
      )
    }
    if (
      terminationProtection.length !== 1 &&
      terminationProtection.length != stackName.length
    ) {
      throw new Error(
        'number input termination-protection lines must match name lines or must be a single line'
      )
    }

    const concurrency = parseNumber(
      core.getInput('concurrency', {
        required: false
      })
    )
    const limit = pLimit(concurrency || 5)

    const tasks = template.map((_, i) =>
      limit(() =>
        task(cfn, {
          template: template[i],
          stackName: stackName[i],
          capabilities: pickOption(capabilities, i),
          roleARN: pickOption(roleARN, i),
          notificationARNs: pickOption(notificationARNs, i),
          disableRollback: pickOption(disableRollback, i),
          timeoutInMinutes: pickOption(timeoutInMinutes, i),
          tags: pickOption(tags, i),
          terminationProtection: pickOption(terminationProtection, i),
          parameterOverrides: pickOption(parameterOverrides, i),
          noEmptyChangeSet: pickOption(noEmptyChangeSet, i),
          noExecuteChangeSet: pickOption(noExecuteChangeSet, i),
          noDeleteFailedChangeSet: pickOption(noDeleteFailedChangeSet, i)
        }).catch(err => {
          core.error(`${stackName[i]}: Error`)
          throw err
        })
      )
    )

    await Promise.all(tasks)
  } catch (err) {
    if (err instanceof Error || typeof err === 'string') {
      core.setFailed(err)
      // @ts-ignore
      console.debug(err.stack)
    }
  }
}

/* istanbul ignore next */
if (require.main === module) {
  run()
}
