#!/usr/bin/env node

/**
 * Compute Stack for the Image Processing application.
 * Contains Lambda functions for Step Functions workflow.
 */

import { Duration, Size, Stack } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { ComputeStackProps, ComputeStackOutputs } from '../types';
import { applyCdkNag, SecuritySuppressions } from '../utils';

export class ComputeStack extends Stack {
  public readonly outputs: ComputeStackOutputs;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    // Create StartImageProcessingWorkflowFunction
    const startWorkflowFunction = new lambda.Function(this, 'StartImageProcessingWorkflowFunction', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'app.lambda_handler',
      code: lambda.Code.fromAsset('src/start-image-processing-workflow'),
      timeout: Duration.seconds(120),
      memorySize: 128,
      environment: {
        INPUT_BUCKET: props.bucket.bucketName,
        IMAGE_PREFIX: props.config.imagePrefix,
        GENERATED_IMAGE_PREFIX: props.config.generatedImagePrefix,
        STATUS_REPORT_PREFIX: props.config.statusReportPrefix
      }
    });

    // Create BuildBedrockRequestFunction
    const buildRequestFunction = new lambda.Function(this, 'BuildBedrockRequestFunction', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'app.lambda_handler',
      code: lambda.Code.fromAsset('src/build-bedrock-request'),
      memorySize: 512,
      ephemeralStorageSize: Size.mebibytes(1024)
    });

    // Create ParseBedrockResponseFunction
    const parseResponseFunction = new lambda.Function(this, 'ParseBedrockResponseFunction', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'app.lambda_handler',
      code: lambda.Code.fromAsset('src/parse-bedrock-response'),
      memorySize: 512,
      ephemeralStorageSize: Size.mebibytes(1024)
    });

    // Create GenerateStatusReportFunction
    const statusReportFunction = new lambda.Function(this, 'GenerateStatusReportFunction', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'app.lambda_handler',
      code: lambda.Code.fromAsset('src/generate-status-report'),
      memorySize: 128,
      environment: {
        STATUS_TABLE: props.statusTable.tableName,
        STATUS_REPORT_URL_EXPIRATION: props.config.statusReportUrlExpiration.toString()
      }
    });

    // Grant permissions
    props.bucket.grantReadWrite(buildRequestFunction);
    props.bucket.grantReadWrite(parseResponseFunction);
    props.bucket.grantReadWrite(statusReportFunction);
    props.statusTable.grantReadData(statusReportFunction);

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
