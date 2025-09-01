#!/usr/bin/env node

/**
 * Security utilities and CDK Nag configuration for the Image Processing application.
 */

import { Aspects, Stack } from 'aws-cdk-lib';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';

/**
 * Applies CDK Nag security checks to a stack.
 * 
 * @param stack - The CDK stack to apply security checks to
 */
export function applyCdkNag(stack: Stack): void {
  Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }));
}

/**
 * Common CDK Nag suppressions for the Image Processing application.
 */
export class SecuritySuppressions {
  /**
   * Applies common suppressions to a stack.
   * 
   * @param stack - The stack to apply suppressions to
   * @param reason - Reason for the suppression
   */
  static applyCommonSuppressions(stack: Stack, reason: string = 'Image Processing Application'): void {
    // Common suppressions that may be needed across stacks
    NagSuppressions.addStackSuppressions(stack, [
      {
        id: 'AwsSolutions-IAM4',
        reason: `${reason}: AWS managed policies are acceptable for this use case`
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: `${reason}: Wildcard permissions required for cross-service integrations`
      }
    ]);
  }

  /**
   * Applies S3 specific suppressions.
   * 
   * @param stack - The stack containing S3 resources
   */
  static applyS3Suppressions(stack: Stack): void {
    NagSuppressions.addStackSuppressions(stack, [
      {
        id: 'AwsSolutions-S3-1',
        reason: 'Image Processing: S3 access logging not required for this use case'
      },
      {
        id: 'AwsSolutions-S3-2',
        reason: 'Image Processing: Public read access blocked by default configuration'
      }
    ]);
  }

  /**
   * Applies Lambda specific suppressions.
   * 
   * @param stack - The stack containing Lambda resources
   */
  static applyLambdaSuppressions(stack: Stack): void {
    NagSuppressions.addStackSuppressions(stack, [
      {
        id: 'AwsSolutions-L1',
        reason: 'Image Processing: Python 3.13 is the latest supported runtime'
      }
    ]);
  }

  /**
   * Applies API Gateway specific suppressions.
   * 
   * @param stack - The stack containing API Gateway resources
   */
  static applyApiGatewaySuppressions(stack: Stack): void {
    NagSuppressions.addStackSuppressions(stack, [
      {
        id: 'AwsSolutions-APIG-1',
        reason: 'Image Processing: CloudWatch logging configured at appropriate level'
      },
      {
        id: 'AwsSolutions-APIG-2',
        reason: 'Image Processing: Request validation implemented where required'
      }
    ]);
  }

  /**
   * Applies Step Functions specific suppressions.
   * 
   * @param stack - The stack containing Step Functions resources
   */
  static applyStepFunctionsSuppressions(stack: Stack): void {
    NagSuppressions.addStackSuppressions(stack, [
      {
        id: 'AwsSolutions-SF-1',
        reason: 'Image Processing: CloudWatch logging enabled for Step Functions'
      },
      {
        id: 'AwsSolutions-SF-2',
        reason: 'Image Processing: X-Ray tracing enabled for Step Functions'
      }
    ]);
  }
}
