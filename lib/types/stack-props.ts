#!/usr/bin/env node

/**
 * Base stack props interfaces for all CDK constructs.
 */

import { StackProps } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as sns from 'aws-cdk-lib/aws-sns';
import { ImageProcessingConfig } from './config';

/**
 * Base props for all image processing stacks.
 */
export interface BaseStackProps extends StackProps {
  readonly config: ImageProcessingConfig;
}

/**
 * Props for Storage Stack.
 */
export interface StorageStackProps extends BaseStackProps {}

/**
 * Outputs from Storage Stack.
 */
export interface StorageStackOutputs {
  readonly bucket: s3.Bucket;
  readonly imagesTable: dynamodb.Table;
  readonly statusTable: dynamodb.Table;
}

/**
 * Props for Authentication Stack.
 */
export interface AuthStackProps extends BaseStackProps {}

/**
 * Outputs from Authentication Stack.
 */
export interface AuthStackOutputs {
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  readonly authorizer: apigateway.CognitoUserPoolsAuthorizer;
  readonly userPoolClientSecret?: string; // Available via userPoolClient.userPoolClientSecret
}

/**
 * Props for API Stack.
 */
export interface ApiStackProps extends BaseStackProps {
  readonly userPool: cognito.UserPool;
  readonly imagesTable: dynamodb.Table;
}

/**
 * Outputs from API Stack.
 */
export interface ApiStackOutputs {
  readonly api: apigateway.RestApi;
  readonly apiUrl: string;
}

/**
 * Props for Compute Stack.
 */
export interface ComputeStackProps extends BaseStackProps {
  readonly bucket: s3.Bucket;
  readonly imagesTable: dynamodb.Table;
  readonly statusTable: dynamodb.Table;
  readonly snsTopic: sns.Topic;
}

/**
 * Outputs from Compute Stack.
 */
export interface ComputeStackOutputs {
  readonly startWorkflowFunction: lambda.Function;
  readonly buildRequestFunction: lambda.Function;
  readonly parseResponseFunction: lambda.Function;
  readonly statusReportFunction: lambda.Function;
}

/**
 * Props for Orchestration Stack.
 */
export interface OrchestrationStackProps extends BaseStackProps {
  readonly computeFunctions: ComputeStackOutputs;
  readonly bucket: s3.Bucket;
  readonly statusTable: dynamodb.Table;
  readonly snsTopic: sns.Topic;
}

/**
 * Outputs from Orchestration Stack.
 */
export interface OrchestrationStackOutputs {
  readonly stateMachine: stepfunctions.StateMachine;
}

/**
 * Props for Notification Stack.
 */
export interface NotificationStackProps extends BaseStackProps {}

/**
 * Outputs from Notification Stack.
 */
export interface NotificationStackOutputs {
  readonly topic: sns.Topic;
}
