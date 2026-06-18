import * as core from '@actions/core'
import {
  CreateStackCommand,
  CreateChangeSetCommand,
  DescribeChangeSetCommand,
  DeleteChangeSetCommand,
  ExecuteChangeSetCommand,
  DescribeStacksCommand,
  waitUntilStackCreateComplete,
  waitUntilStackUpdateComplete,
  waitUntilChangeSetCreateComplete
} from '@aws-sdk/client-cloudformation'

// Maximum time (in seconds) to wait for a stack/change set operation to reach
// its terminal state, matching the AWS SDK v2 waiter defaults (120 attempts of
// 30s).
const MAX_WAIT_TIME_IN_SECONDS = 3600

export async function cleanupChangeSet(
  cfn,
  stack,
  params,
  noEmptyChangeSet,
  noDeleteFailedChangeSet
) {
  const knownErrorMessages = [
    `No updates are to be performed`,
    `The submitted information didn't contain changes`
  ]

  const changeSetStatus = await cfn.send(
    new DescribeChangeSetCommand({
      ChangeSetName: params.ChangeSetName,
      StackName: params.StackName
    })
  )

  if (changeSetStatus.Status === 'FAILED') {
    core.debug(`${stack.StackName}: Deleting failed Change Set`)

    if (noDeleteFailedChangeSet === false) {
      await cfn.send(
        new DeleteChangeSetCommand({
          ChangeSetName: params.ChangeSetName,
          StackName: params.StackName
        })
      )
    }

    if (
      noEmptyChangeSet &&
      knownErrorMessages.some(err =>
        changeSetStatus.StatusReason?.includes(err)
      )
    ) {
      return stack.StackId
    }

    throw new Error(
      `Failed to create Change Set: ${changeSetStatus.StatusReason}`
    )
  }
}

export async function updateStack(
  cfn,
  stack,
  params,
  noEmptyChangeSet,
  noExecuteChangeSet,
  noDeleteFailedChangeSet
) {
  core.debug(`${stack.StackName}: Creating CloudFormation Change Set`)
  await cfn.send(new CreateChangeSetCommand(params))

  try {
    core.debug(
      `${stack.StackName}: Waiting for CloudFormation Change Set creation`
    )
    await waitUntilChangeSetCreateComplete(
      { client: cfn, maxWaitTime: MAX_WAIT_TIME_IN_SECONDS },
      {
        ChangeSetName: params.ChangeSetName,
        StackName: params.StackName
      }
    )
  } catch {
    return cleanupChangeSet(
      cfn,
      stack,
      params,
      noEmptyChangeSet,
      noDeleteFailedChangeSet
    )
  }

  if (noExecuteChangeSet === true) {
    core.debug(`${stack.StackName}: Not executing the change set`)
    return stack.StackId
  }

  core.debug(`${stack.StackName}: Executing CloudFormation change set`)
  await cfn.send(
    new ExecuteChangeSetCommand({
      ChangeSetName: params.ChangeSetName,
      StackName: params.StackName
    })
  )

  core.debug(`${stack.StackName}: Updating CloudFormation stack`)
  await waitUntilStackUpdateComplete(
    { client: cfn, maxWaitTime: MAX_WAIT_TIME_IN_SECONDS },
    { StackName: stack.StackId }
  )

  return stack.StackId
}

async function getStack(cfn, stackNameOrId) {
  try {
    const stacks = await cfn.send(
      new DescribeStacksCommand({
        StackName: stackNameOrId
      })
    )
    return stacks.Stacks?.[0]
  } catch (e) {
    if (e instanceof Error && e.message.match(/does not exist/)) {
      return undefined
    }
    throw e
  }
}

export async function deployStack(
  cfn,
  params,
  noEmptyChangeSet,
  noExecuteChangeSet,
  noDeleteFailedChangeSet
) {
  const stack = await getStack(cfn, params.StackName)

  if (!stack) {
    core.debug(`${params.StackName}: Creating CloudFormation Stack`)

    const stack = await cfn.send(new CreateStackCommand(params))
    await waitUntilStackCreateComplete(
      { client: cfn, maxWaitTime: MAX_WAIT_TIME_IN_SECONDS },
      { StackName: params.StackName }
    )

    return stack.StackId
  }

  return await updateStack(
    cfn,
    stack,
    {
      ChangeSetName: `${params.StackName}-CS`,
      ...{
        StackName: params.StackName,
        TemplateBody: params.TemplateBody,
        TemplateURL: params.TemplateURL,
        Parameters: params.Parameters,
        Capabilities: params.Capabilities,
        ResourceTypes: params.ResourceTypes,
        RoleARN: params.RoleARN,
        RollbackConfiguration: params.RollbackConfiguration,
        NotificationARNs: params.NotificationARNs,
        Tags: params.Tags
      }
    },
    noEmptyChangeSet,
    noExecuteChangeSet,
    noDeleteFailedChangeSet
  )
}

export async function getStackOutputs(cfn, stackId) {
  const outputs = new Map()
  const stack = await getStack(cfn, stackId)

  if (stack && stack.Outputs) {
    for (const output of stack.Outputs) {
      if (output.OutputKey && output.OutputValue) {
        outputs.set(output.OutputKey, output.OutputValue)
      }
    }
  }

  return outputs
}
