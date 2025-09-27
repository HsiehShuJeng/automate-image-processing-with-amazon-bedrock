#!/usr/bin/env node

/**
 * Orchestration Stack for the Image Processing application.
 * Manages the Step Functions workflow that coordinates Bedrock, Lambda, DynamoDB, and SNS.
 */

import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { OrchestrationStackOutputs, OrchestrationStackProps } from '../types';
import { applyCdkNag, SecuritySuppressions } from '../utils';

export class OrchestrationStack extends Stack {
  public readonly outputs: OrchestrationStackOutputs;

  constructor(scope: Construct, id: string, props: OrchestrationStackProps) {
    super(scope, id, props);

    const logGroup = new logs.LogGroup(this, 'ImageProcessingWorkflowLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY
    });

    const bedrockModelArn = `arn:aws:bedrock:us-east-1::foundation-model/${props.config.bedrockModelId}`;

    const updateFailedTask = new tasks.DynamoPutItem(this, "Update 'Failed' Status", {
      table: props.statusTable,
      item: {
        Id: tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$.Id')),
        ImageName: tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$.Image.ImageName')),
        Status: tasks.DynamoAttributeValue.fromString('Failed'),
        Error: tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$.Status.Error')),
        Cause: tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$.Status.Cause'))
      }
    });

    const updateSucceededTask = new tasks.DynamoPutItem(this, "Update 'Succeeded' Status", {
      table: props.statusTable,
      item: {
        Id: tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$.Id')),
        ImageName: tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$.Image.ImageName')),
        Status: tasks.DynamoAttributeValue.fromString('Succeeded')
      }
    });

    const buildBedrockRequestTask = new tasks.LambdaInvoke(this, 'Build Bedrock Request', {
      lambdaFunction: props.computeFunctions.buildRequestFunction,
      payload: stepfunctions.TaskInput.fromJsonPathAt('$'),
      resultPath: stepfunctions.JsonPath.DISCARD
    });
    buildBedrockRequestTask.addRetry({
      errors: [
        'Lambda.ServiceException',
        'Lambda.AWSLambdaException',
        'Lambda.SdkClientException',
        'Lambda.TooManyRequestsException'
      ],
      interval: Duration.seconds(1),
      maxAttempts: 3,
      backoffRate: 2
    });
    buildBedrockRequestTask.addCatch(updateFailedTask, {
      resultPath: '$.Status'
    });

    const bedrockInvokeTask = new tasks.CallAwsService(this, 'Bedrock InvokeModel', {
      service: 'bedrock',
      action: 'invokeModel',
      iamAction: 'bedrock:InvokeModel',
      iamResources: [bedrockModelArn],
      parameters: {
        ModelId: bedrockModelArn,
        Input: {
          S3Uri: stepfunctions.JsonPath.format(
            's3://{}/{}/{}.json',
            stepfunctions.JsonPath.stringAt('$.S3Bucket'),
            stepfunctions.JsonPath.stringAt('$.InputS3Prefix'),
            stepfunctions.JsonPath.arrayGetItem(
              stepfunctions.JsonPath.stringSplit(stepfunctions.JsonPath.stringAt('$.Image.ImageName'), '.'),
              0
            )
          )
        },
        Output: {
          S3Uri: stepfunctions.JsonPath.format(
            's3://{}/{}/{}.json',
            stepfunctions.JsonPath.stringAt('$.S3Bucket'),
            stepfunctions.JsonPath.stringAt('$.OutputS3Prefix'),
            stepfunctions.JsonPath.arrayGetItem(
              stepfunctions.JsonPath.stringSplit(stepfunctions.JsonPath.stringAt('$.Image.ImageName'), '.'),
              0
            )
          )
        },
        ContentType: 'application/json'
      },
      resultPath: '$.output'
    });
    bedrockInvokeTask.addCatch(updateFailedTask, {
      resultPath: '$.Status'
    });

    const parseBedrockResponseTask = new tasks.LambdaInvoke(this, 'Parse Bedrock Response', {
      lambdaFunction: props.computeFunctions.parseResponseFunction,
      payload: stepfunctions.TaskInput.fromJsonPathAt('$'),
      resultPath: stepfunctions.JsonPath.DISCARD
    });
    parseBedrockResponseTask.addRetry({
      errors: [
        'Lambda.ServiceException',
        'Lambda.AWSLambdaException',
        'Lambda.SdkClientException',
        'Lambda.TooManyRequestsException'
      ],
      interval: Duration.seconds(1),
      maxAttempts: 3,
      backoffRate: 2
    });
    parseBedrockResponseTask.addCatch(updateFailedTask, {
      resultPath: '$.Status'
    });

    const map = new stepfunctions.DistributedMap(this, 'Process Images', {
      itemsPath: stepfunctions.JsonPath.stringAt('$.Images'),
      itemSelector: {
        Id: stepfunctions.JsonPath.stringAt('$.Id'),
        S3Bucket: stepfunctions.JsonPath.stringAt('$.S3Bucket'),
        InputS3Prefix: stepfunctions.JsonPath.stringAt('$.InputS3Prefix'),
        OutputS3Prefix: stepfunctions.JsonPath.stringAt('$.OutputS3Prefix'),
        Prompt: stepfunctions.JsonPath.stringAt('$.Prompt'),
        NegativePrompt: stepfunctions.JsonPath.stringAt('$.NegativePrompt'),
        Mode: stepfunctions.JsonPath.stringAt('$.Mode'),
        Image: stepfunctions.JsonPath.objectAt('$$.Map.Item.Value')
      },
      maxConcurrency: props.config.maxConcurrency,
      label: 'Map',
      toleratedFailurePercentage: 90,
      resultPath: stepfunctions.JsonPath.DISCARD
    });

    map.itemProcessor(
      buildBedrockRequestTask
        .next(bedrockInvokeTask)
        .next(parseBedrockResponseTask)
        .next(updateSucceededTask)
    );

    const generateStatusReportTask = new tasks.LambdaInvoke(this, 'Generate Status Report', {
      lambdaFunction: props.computeFunctions.statusReportFunction,
      payload: stepfunctions.TaskInput.fromJsonPathAt('$'),
      resultSelector: {
        ReportURL: stepfunctions.JsonPath.stringAt('$.Payload.ReportURL'),
        ReportS3Key: stepfunctions.JsonPath.stringAt('$.Payload.ReportS3Key')
      },
      resultPath: '$.StatusReport'
    });
    generateStatusReportTask.addRetry({
      errors: [
        'Lambda.ServiceException',
        'Lambda.AWSLambdaException',
        'Lambda.SdkClientException',
        'Lambda.TooManyRequestsException'
      ],
      interval: Duration.seconds(1),
      maxAttempts: 3,
      backoffRate: 2
    });

    const sendEmailTask = new tasks.SnsPublish(this, 'Send Email', {
      topic: props.snsTopic,
      message: stepfunctions.TaskInput.fromText(
        stepfunctions.JsonPath.format(
          'Hi,\n\nWe are pleased to inform you that the image processing has been successfully completed.\n\nYou can access the status report at the following link: \ns3://{}/{}/\n\nAll processed images can be found in the S3 bucket at the following location:\n\ns3://{}/{}/\n\nThank you.\n\nBest regards,\n\nIT Team',
          stepfunctions.JsonPath.stringAt('$.S3Bucket'),
          stepfunctions.JsonPath.stringAt('$.StatusS3Prefix'),
          stepfunctions.JsonPath.stringAt('$.S3Bucket'),
          stepfunctions.JsonPath.stringAt('$.OutputS3Prefix')
        )
      ),
      subject: 'Image Processing Completed - Status Report Available',
      resultPath: stepfunctions.JsonPath.DISCARD
    });

    map.next(generateStatusReportTask);
    generateStatusReportTask.next(sendEmailTask);

    const definition = map;

    const stateMachine = new stepfunctions.StateMachine(this, 'ImageProcessingWorkflow', {
      stateMachineName: props.config.imageProcessingWorkflowName,
      definitionBody: stepfunctions.DefinitionBody.fromChainable(definition),
      tracingEnabled: true,
      logs: {
        destination: logGroup,
        level: stepfunctions.LogLevel.ALL,
        includeExecutionData: true
      },
      timeout: Duration.minutes(15)
    });

    stateMachine.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [bedrockModelArn]
    }));

    stateMachine.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [
        props.computeFunctions.buildRequestFunction.functionArn,
        `${props.computeFunctions.buildRequestFunction.functionArn}:*`,
        props.computeFunctions.parseResponseFunction.functionArn,
        `${props.computeFunctions.parseResponseFunction.functionArn}:*`,
        props.computeFunctions.statusReportFunction.functionArn,
        `${props.computeFunctions.statusReportFunction.functionArn}:*`
      ]
    }));

    stateMachine.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:PutItem'],
      resources: [props.statusTable.tableArn]
    }));

    stateMachine.addToRolePolicy(new iam.PolicyStatement({
      actions: ['sns:Publish'],
      resources: [props.snsTopic.topicArn]
    }));

    stateMachine.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject', 's3:AbortMultipartUpload', 's3:ListMultipartUploadParts'],
      resources: [props.bucket.arnForObjects('*')]
    }));

    stateMachine.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'xray:PutTraceSegments',
        'xray:PutTelemetryRecords',
        'xray:GetSamplingRules',
        'xray:GetSamplingTargets'
      ],
      resources: ['*']
    }));

    applyCdkNag(this);
    SecuritySuppressions.applyCommonSuppressions(this, 'Orchestration Stack');
    SecuritySuppressions.applyStepFunctionsSuppressions(this);

    this.outputs = {
      stateMachine
    };
  }
}
