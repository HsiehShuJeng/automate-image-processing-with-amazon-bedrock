#!/usr/bin/env node

/**
 * Compute Stack for the Image Processing application.
 * Contains Lambda functions for Step Functions workflow with DynamoDB stream trigger.
 */

import { Duration, Size, Stack } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import { LambdaToSns } from '@aws-solutions-constructs/aws-lambda-sns';
import { Construct } from 'constructs';
import { ComputeStackProps, ComputeStackOutputs } from '../types';
import { applyCdkNag, SecuritySuppressions } from '../utils';
import { join } from 'path';
import { execSync } from 'child_process';
import { mkdirSync } from 'fs';

export class ComputeStack extends Stack {
  public readonly outputs: ComputeStackOutputs;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const powertoolsLayerSourcePath = join(__dirname, '..', '..', 'layers', 'powertools');
    const bundlingDisabled = process.env.CDK_DISABLE_POWETOOLS_BUNDLING === 'true';
    const powertoolsLayerCode = lambda.Code.fromAsset(
      powertoolsLayerSourcePath,
      bundlingDisabled
        ? {
            exclude: ['*.pyc', '__pycache__']
          }
        : {
            bundling: {
              local: {
                tryBundle(outputDir: string): boolean {
                  const outputPythonPath = join(outputDir, 'python');
                  mkdirSync(outputPythonPath, { recursive: true });
                  try {
                    execSync(`pip3 install -r requirements.txt -t "${outputPythonPath}"`, {
                      cwd: powertoolsLayerSourcePath,
                      stdio: 'inherit'
                    });
                  } catch (error) {
                    console.error('Local installation of AWS Lambda Powertools failed.', error);
                    return false;
                  }
                  return true;
                }
              },
              image: lambda.Runtime.PYTHON_3_13.bundlingImage,
              command: [
                'bash',
                '-c',
                'pip install -r requirements.txt -t /asset-output/python'
              ]
            }
          }
    );

    const powertoolsLayer = new lambda.LayerVersion(this, 'PowertoolsLayer', {
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_13],
      description: 'Shared AWS Lambda Powertools dependencies',
      code: powertoolsLayerCode
    });

    const commonUtilitiesLayer = new lambda.LayerVersion(this, 'CommonUtilitiesLayer', {
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_13],
      description: 'Shared utilities for image processing Lambdas',
      code: lambda.Code.fromAsset(join(__dirname, '..', '..', 'layers', 'common-utils'))
    });

    const stateMachineName = props.config.imageProcessingWorkflowName;
    const stateMachineArn = this.formatArn({
      service: 'states',
      resource: 'stateMachine',
      resourceName: stateMachineName
    });

    // Create StartImageProcessingWorkflowFunction with DynamoDB stream trigger
    const startWorkflowFunction = new lambda.Function(this, 'StartImageProcessingWorkflowFunction', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'app.lambda_handler',
      code: lambda.Code.fromAsset('src/start-image-processing-workflow'),
      timeout: Duration.seconds(120), // Specific timeout per SAM template
      memorySize: 128,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_MONTH,
      layers: [powertoolsLayer, commonUtilitiesLayer],
      environment: {
        STATE_MACHINE_IMAGE_PROCESSING_NAME: stateMachineName,
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
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_MONTH,
      layers: [powertoolsLayer, commonUtilitiesLayer],
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
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_MONTH,
      layers: [powertoolsLayer, commonUtilitiesLayer],
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
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_MONTH,
      layers: [powertoolsLayer, commonUtilitiesLayer],
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
    props.statusTable.grantReadWriteData(statusReportFunction);

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
