## AWS CloudFormation "Deploy CloudFormation Stack" Action for GitHub Actions

Deploys AWS CloudFormation stacks.

## Usage

To deploy a single stack:

```yaml
- name: Deploy AWS CloudFormation stack
  uses: widdix/aws-cloudformation-github-deploy@v2
  with:
    name: MyStack
    template: myStack.yaml
    parameter-overrides: "MyParam1=myValue,MyParam2=${{ secrets.MY_SECRET_VALUE }}"
```
 
To dedploy multiple stacks in parallel:

```yaml
- name: Deploy AWS CloudFormation stacks
  uses: widdix/aws-cloudformation-github-deploy@v2
  with:
    name: |
      MyStack1
      MyStack2
    template: |
      myStack1.yaml
      myStack2.yaml
    parameter-overrides: |
      MyParam1=myValue,MyParam2=${{ secrets.MY_SECRET_VALUE }}
      MyParam1=myValue
```

To dedploy multiple stacks in parallel using the same settings for all stacks:

```yaml
- name: Deploy AWS CloudFormation stacks
  uses: widdix/aws-cloudformation-github-deploy@v2
  with:
    name: |
      MyStack1
      MyStack2
      MyStack3
    template: |
      myStack1.yaml
      myStack2.yaml
      myStack3.yaml
    disable-rollback: "1" # applies to all three stacks
```

To dedploy multiple stacks in parallel passing in no values for a specific stack using a empty line:

```yaml
- name: Deploy AWS CloudFormation stacks
  uses: widdix/aws-cloudformation-github-deploy@v2
  with:
    name: |
      MyStack1
      MyStack2
      MyStack3
    template: |
      myStack1.yaml
      myStack2.yaml
      myStack3.yaml
    parameter-overrides: |
      MyParam1=myValue,MyParam2=${{ secrets.MY_SECRET_VALUE }}
      
      MyParam1=myValue
```

The action can be passed a CloudFormation Stack `name` and a `template` file. The `template` file can be a local file existing in the working directory, or a URL to template that exists in an [Amazon S3](https://aws.amazon.com/s3/) bucket. It will create the Stack if it does not exist, or create a [Change Set](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-changesets.html) to update the Stack. 

See [action.yml](action.yml) for the full documentation for this action's inputs and outputs.

## Example

```yaml
name: Deploy

on: [push]

jobs:
  deploy:
    name: Deploy
    runs-on: ubuntu-latest
    steps:
    - name: Checkout
      uses: actions/checkout@v3
    - name: Configure AWS credentials
      id: creds
      uses: aws-actions/configure-aws-credentials@v1
      with:
        # ...
        aws-region: us-east-1
    - name: Deploy AWS CloudFormation stacks
      uses: widdix/aws-cloudformation-github-deploy@v2
      with:
        name: |
          MyStack1
          MyStack2
        template: |
          myStack1.yaml
          myStack2.yaml
        parameter-overrides: |
          MyParam1=myValue,MyParam2=${{ secrets.MY_SECRET_VALUE }}
          MyParam1=myValue
        disable-rollback: "1" # applies to all two stacks
```
