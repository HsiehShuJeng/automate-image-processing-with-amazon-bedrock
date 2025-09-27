#!/usr/bin/env node

/**
 * Compute Stack for the Image Processing application.
 * Contains Lambda functions for Step Functions workflow with DynamoDB stream trigger.
 */

import { Duration, Size, Stack } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import { LambdaToSns } from '@aws-solutions-constructs/aws-lambda-sns';
import { Construct } from 'constructs';
import { ComputeStackProps, ComputeStackOutputs } from '../types';
import { applyCdkNag, SecuritySuppressions } from '../utils';

export class ComputeStack extends Stack {
  public readonly outputs: ComputeStackOutputs;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    // AWS Lambda Powertools Layer (official AWS-provided layer)
    const powertoolsLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      'PowertoolsLayer',
      `arn:aws:lambda:${this.region}:017000801446:layer:AWSLambdaPowertoolsPythonV2:68`
    );

    const stateMachineArn = this.formatArn({
      service: 'states',
      resource: 'stateMachine',
      resourceName: props.config.imageProcessingWorkflowName
    });

    // Create StartImageProcessingWorkflowFunction with DynamoDB stream trigger
    const startWorkflowFunction = new lambda.Function(this, 'StartImageProcessingWorkflowFunction', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'app.lambda_handler',
      code: lambda.Code.fromAsset('src/start-image-processing-workflow'),
      timeout: Duration.seconds(120), // Specific timeout per SAM template
      memorySize: 128,
      layers: [powertoolsLayer],
      environment: {
        STATE_MACHINE_IMAGE_PROCESSING_ARN: stateMachineArn,
        INPUT_BUCKET: props.bucket.bucketName,
        IMAGE_PREFIX: props.config.imagePrefix,
        GENERATED_IMAGE_PREFIX: props.config.generatedImagePrefix,
        STATUS_REPORT_PREFIX: props.config.statusReportPrefix,
        POWERTOOLS_SERVICE_NAME: 'image-processing',
        POWERTOOLS_METRICS_NAMESPACE: 'ImageProcessing'
      }
    });

    // Add DynamoDB stream event source with BatchSize=1, StartingPosition=LATEST
    startWorkflowFunction.addEventSource(
      new lambdaEventSources.DynamoEventSource(props.imagesTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 1
      })
    );

    startWorkflowFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['states:StartExecution'],
        resources: [stateMachineArn]
      })
    );

    // Create BuildBedrockRequestFunction with 900s timeout per SAM global setting
    const buildRequestFunction = new lambda.Function(this, 'BuildBedrockRequestFunction', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'app.lambda_handler',
      code: lambda.Code.fromAsset('src/build-bedrock-request'),
      timeout: Duration.seconds(900), // Global timeout per SAM template
      memorySize: 512,
      ephemeralStorageSize: Size.mebibytes(1024),
      layers: [powertoolsLayer],
      environment: {
        POWERTOOLS_SERVICE_NAME: 'image-processing',
        POWERTOOLS_METRICS_NAMESPACE: 'ImageProcessing'
      }
    });

    // Create ParseBedrockResponseFunction with 900s timeout per SAM global setting
    const parseResponseFunction = new lambda.Function(this, 'ParseBedrockResponseFunction', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'app.lambda_handler',
      code: lambda.Code.fromAsset('src/parse-bedrock-response'),
      timeout: Duration.seconds(900), // Global timeout per SAM template
      memorySize: 512,
      ephemeralStorageSize: Size.mebibytes(1024),
      layers: [powertoolsLayer],
      environment: {
        POWERTOOLS_SERVICE_NAME: 'image-processing',
        POWERTOOLS_METRICS_NAMESPACE: 'ImageProcessing'
      }
    });

    // Create GenerateStatusReportFunction with 900s timeout per SAM global setting
    const statusReportFunction = new lambda.Function(this, 'GenerateStatusReportFunction', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'app.lambda_handler',
      code: lambda.Code.fromAsset('src/generate-status-report'),
      timeout: Duration.seconds(900), // Global timeout per SAM template
      memorySize: 128,
      layers: [powertoolsLayer],
      environment: {
        STATUS_TABLE: props.statusTable.tableName,
        STATUS_REPORT_URL_EXPIRATION: props.config.statusReportUrlExpiration.toString(),
        POWERTOOLS_SERVICE_NAME: 'image-processing',
        POWERTOOLS_METRICS_NAMESPACE: 'ImageProcessing'
      }
    });

    // Grant permissions
    props.bucket.grantReadWrite(buildRequestFunction);
    props.bucket.grantReadWrite(parseResponseFunction);
    props.bucket.grantReadWrite(statusReportFunction);
    props.statusTable.grantReadData(statusReportFunction);

    new LambdaToSns(this, 'StatusReportNotifications', {
      existingLambdaObj: statusReportFunction,
      existingTopicObj: props.snsTopic,
      topicArnEnvironmentVariableName: 'NOTIFICATION_TOPIC_ARN',
      topicNameEnvironmentVariableName: 'NOTIFICATION_TOPIC_NAME'
    });

    // Apply CDK Nag security checks
    applyCdkNag(this);
    SecuritySuppressions.applyCommonSuppressions(this, 'Compute Stack');
    SecuritySuppressions.applyLambdaSuppressions(this);

    // Export outputs
    this.outputs = {
      startWorkflowFunction,
      buildRequestFunction,
      parseResponseFunction,
      statusReportFunction
    };
  }
}
