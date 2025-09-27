#!/usr/bin/env node

/**
 * Orchestration Stack for the Image Processing application.
 * Manages the Step Functions workflow that coordinates Bedrock, Lambda, DynamoDB, and SNS.
 */

import * as path from 'path';
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';
import { OrchestrationStackOutputs, OrchestrationStackProps } from '../types';
import { applyCdkNag, SecuritySuppressions } from '../utils';

export class OrchestrationStack extends Stack {
  public readonly outputs: OrchestrationStackOutputs;

  constructor(scope: Construct, id: string, props: OrchestrationStackProps) {
    super(scope, id, props);

    const definitionBody = stepfunctions.DefinitionBody.fromFile(
      path.join(__dirname, '..', '..', 'statemachine', 'image-processing-workflow.asl.json')
    );

    const logGroup = new logs.LogGroup(this, 'ImageProcessingWorkflowLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY
    });

    const bedrockModelArn = `arn:aws:bedrock:us-east-1::foundation-model/${props.config.bedrockModelId}`;

    const stateMachine = new stepfunctions.StateMachine(this, 'ImageProcessingWorkflow', {
      stateMachineName: props.config.imageProcessingWorkflowName,
      definitionBody,
      definitionSubstitutions: {
        MaxConcurrency: props.config.maxConcurrency.toString(),
        BuildBedrockRequestFunctionArn: props.computeFunctions.buildRequestFunction.functionArn,
        ParseBedrockResponseFunctionArn: props.computeFunctions.parseResponseFunction.functionArn,
        GenerateStatusReportFunctionArn: props.computeFunctions.statusReportFunction.functionArn,
        StatusTableName: props.statusTable.tableName,
        NotificationSNSTopicArn: props.snsTopic.topicArn,
        BedrockModelArn: bedrockModelArn
      },
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

    props.computeFunctions.startWorkflowFunction.addEnvironment(
      'STATE_MACHINE_IMAGE_PROCESSING_ARN',
      stateMachine.stateMachineArn
    );
    stateMachine.grantStartExecution(props.computeFunctions.startWorkflowFunction);

    applyCdkNag(this);
    SecuritySuppressions.applyCommonSuppressions(this, 'Orchestration Stack');
    SecuritySuppressions.applyStepFunctionsSuppressions(this);

    this.outputs = {
      stateMachine
    };
  }
}
