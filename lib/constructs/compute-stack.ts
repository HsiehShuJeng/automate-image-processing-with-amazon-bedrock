#!/usr/bin/env node

/**
 * Provision compute resources for the image processing workflow.
 *
 * This stack wires together the Lambda functions, Powertools layer, and
 * permissions required to orchestrate the Step Functions state machine. It
 * mirrors the behaviour of the original SAM implementation while applying CDK
 * best practices for log management, tracing, and dependency layering.
 */

import { Duration, RemovalPolicy, Size, Stack } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { LambdaToSns } from '@aws-solutions-constructs/aws-lambda-sns';
import { Construct } from 'constructs';
import { ComputeStackProps, ComputeStackOutputs } from '../types';
import { applyCdkNag, SecuritySuppressions } from '../utils';
import { join } from 'path';

export class ComputeStack extends Stack {
  public readonly outputs: ComputeStackOutputs;

  /**
   * Creates the compute tier for the image processing workflow, provisioning
   * Lambda functions, shared layers, and IAM permissions. Runtime and
   * architecture defaults can be overridden via {@link ComputeStackProps} to
   * accommodate regional or hardware-specific deployments.
   */
  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const lambdaRuntime = props.runtime ?? lambda.Runtime.PYTHON_3_13;
    const lambdaArchitecture = props.architecture ?? lambda.Architecture.X86_64;

    const powertoolsLayerArn = resolvePowertoolsLayerArn(this, lambdaRuntime, lambdaArchitecture);
    const powertoolsLayer = lambda.LayerVersion.fromLayerVersionArn(this, 'PowertoolsLayer', powertoolsLayerArn);

    const commonUtilitiesLayer = new lambda.LayerVersion(this, 'CommonUtilitiesLayer', {
      compatibleRuntimes: [lambdaRuntime],
      compatibleArchitectures: [lambdaArchitecture],
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
    const startWorkflowLogGroup = createLambdaLogGroup(this, 'StartWorkflowLogGroup');
    const startWorkflowFunction = new lambda.Function(this, 'StartImageProcessingWorkflowFunction', {
      runtime: lambdaRuntime,
      architecture: lambdaArchitecture,
      handler: 'app.lambda_handler',
      code: lambda.Code.fromAsset('src/start-image-processing-workflow'),
      timeout: Duration.seconds(120), // Specific timeout per SAM template
      memorySize: 128,
      tracing: lambda.Tracing.ACTIVE,
      logGroup: startWorkflowLogGroup,
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
    const buildRequestLogGroup = createLambdaLogGroup(this, 'BuildRequestLogGroup');
    const buildRequestFunction = new lambda.Function(this, 'BuildBedrockRequestFunction', {
      runtime: lambdaRuntime,
      architecture: lambdaArchitecture,
      handler: 'app.lambda_handler',
      code: lambda.Code.fromAsset('src/build-bedrock-request'),
      timeout: Duration.seconds(900), // Global timeout per SAM template
      memorySize: 512,
      ephemeralStorageSize: Size.mebibytes(1024),
      tracing: lambda.Tracing.ACTIVE,
      logGroup: buildRequestLogGroup,
      layers: [powertoolsLayer, commonUtilitiesLayer],
      environment: {
        POWERTOOLS_SERVICE_NAME: 'image-processing',
        POWERTOOLS_METRICS_NAMESPACE: 'ImageProcessing'
      }
    });

    // Create ParseBedrockResponseFunction with 900s timeout per SAM global setting
    const parseResponseLogGroup = createLambdaLogGroup(this, 'ParseResponseLogGroup');
    const parseResponseFunction = new lambda.Function(this, 'ParseBedrockResponseFunction', {
      runtime: lambdaRuntime,
      architecture: lambdaArchitecture,
      handler: 'app.lambda_handler',
      code: lambda.Code.fromAsset('src/parse-bedrock-response'),
      timeout: Duration.seconds(900), // Global timeout per SAM template
      memorySize: 512,
      ephemeralStorageSize: Size.mebibytes(1024),
      tracing: lambda.Tracing.ACTIVE,
      logGroup: parseResponseLogGroup,
      layers: [powertoolsLayer, commonUtilitiesLayer],
      environment: {
        POWERTOOLS_SERVICE_NAME: 'image-processing',
        POWERTOOLS_METRICS_NAMESPACE: 'ImageProcessing'
      }
    });

    // Create GenerateStatusReportFunction with 900s timeout per SAM global setting
    const statusReportLogGroup = createLambdaLogGroup(this, 'StatusReportLogGroup');
    const statusReportFunction = new lambda.Function(this, 'GenerateStatusReportFunction', {
      runtime: lambdaRuntime,
      architecture: lambdaArchitecture,
      handler: 'app.lambda_handler',
      code: lambda.Code.fromAsset('src/generate-status-report'),
      timeout: Duration.seconds(900), // Global timeout per SAM template
      memorySize: 128,
      tracing: lambda.Tracing.ACTIVE,
      logGroup: statusReportLogGroup,
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

/**
 * Resolves the ARN of the AWS managed Powertools layer for the supplied runtime
 * and architecture.
 *
 * @param scope construct used to look up the SSM parameter reference.
 * @param runtime targeted Lambda runtime (for example, {@link lambda.Runtime.PYTHON_3_13}).
 * @param architecture CPU architecture used by the Lambda functions (defaults to x86_64).
 * @returns the parameter-resolved ARN for the requested Powertools layer version.
 *
 * @see https://docs.powertools.aws.dev/lambda/python/latest/#lambda-layer_1
 */
function resolvePowertoolsLayerArn(
  scope: Construct,
  runtime: lambda.Runtime,
  architecture: lambda.Architecture = lambda.Architecture.X86_64
): string {
  const archSegment = architecture.name;
  const runtimeSegment = runtime.name;

  return ssm.StringParameter.valueForStringParameter(
    scope,
    `/aws/service/powertools/python/${archSegment}/${runtimeSegment}/latest`
  );
}

/**
 * Creates a CloudWatch Logs group with the project-wide retention policy.
 *
 * @param scope construct scope used for parenting the log group.
 * @param id logical identifier for the log group within the stack.
 * @returns log group configured for 30-day retention and stack cleanup.
 */
function createLambdaLogGroup(scope: Construct, id: string): logs.LogGroup {
  return new logs.LogGroup(scope, id, {
    retention: logs.RetentionDays.ONE_MONTH,
    removalPolicy: RemovalPolicy.DESTROY
  });
}
