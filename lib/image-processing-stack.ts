#!/usr/bin/env node

/**
 * Main stage that composes all Image Processing CDK stacks.
 */

import { Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ApiStack } from './constructs/api-stack';
import { AuthStack } from './constructs/auth-stack';
import { ComputeStack } from './constructs/compute-stack';
import { NotificationStack } from './constructs/notification-stack';
import { OrchestrationStack } from './constructs/orchestration-stack';
import { StorageStack } from './constructs/storage-stack';
import { DEFAULT_CONFIG, ImageProcessingConfig } from './types';

export interface ImageProcessingStageProps extends StageProps {
  /**
   * Configuration parameters for the image processing workflow. Defaults mirror the SAM template.
   */
  readonly config?: ImageProcessingConfig;
  /**
   * Logical environment name used for naming conventions.
   */
  readonly environmentName?: string;
  /**
   * Prefix applied to stack names within the stage.
   */
  readonly stackNamePrefix?: string;
}

export class ImageProcessingStage extends Stage {
  public readonly storageStack: StorageStack;
  public readonly authStack: AuthStack;
  public readonly notificationStack: NotificationStack;
  public readonly computeStack: ComputeStack;
  public readonly orchestrationStack: OrchestrationStack;
  public readonly apiStack: ApiStack;
  public readonly config: ImageProcessingConfig;
  public readonly environmentName: string;
  public readonly stackNamePrefix: string;

  constructor(scope: Construct, id: string, props: ImageProcessingStageProps = {}) {
    super(scope, id, props);

    this.config = props.config ?? DEFAULT_CONFIG;

    this.environmentName = props.environmentName ?? 'dev';
    this.stackNamePrefix = props.stackNamePrefix ?? `ImageProcessing${toPascalCase(this.environmentName)}`;

    const stackEnv = props.env ?? {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1'
    };

    this.storageStack = new StorageStack(this, 'StorageStack', {
      config: this.config,
      env: stackEnv,
      stackName: `${this.stackNamePrefix}-storage`
    });

    this.authStack = new AuthStack(this, 'AuthStack', {
      config: this.config,
      env: stackEnv,
      stackName: `${this.stackNamePrefix}-auth`
    });

    this.notificationStack = new NotificationStack(this, 'NotificationStack', {
      config: this.config,
      env: stackEnv,
      stackName: `${this.stackNamePrefix}-notification`
    });

    this.computeStack = new ComputeStack(this, 'ComputeStack', {
      config: this.config,
      bucket: this.storageStack.outputs.bucket,
      imagesTable: this.storageStack.outputs.imagesTable,
      statusTable: this.storageStack.outputs.statusTable,
      snsTopic: this.notificationStack.outputs.topic,
      env: stackEnv,
      stackName: `${this.stackNamePrefix}-compute`
    });
    this.computeStack.addDependency(this.storageStack);
    this.computeStack.addDependency(this.notificationStack);

    this.orchestrationStack = new OrchestrationStack(this, 'OrchestrationStack', {
      config: this.config,
      computeFunctions: this.computeStack.outputs,
      bucket: this.storageStack.outputs.bucket,
      statusTable: this.storageStack.outputs.statusTable,
      snsTopic: this.notificationStack.outputs.topic,
      env: stackEnv,
      stackName: `${this.stackNamePrefix}-orchestration`
    });
    this.orchestrationStack.addDependency(this.computeStack);
    this.orchestrationStack.addDependency(this.storageStack);
    this.orchestrationStack.addDependency(this.notificationStack);

    this.apiStack = new ApiStack(this, 'ApiStack', {
      config: this.config,
      userPool: this.authStack.outputs.userPool,
      imagesTable: this.storageStack.outputs.imagesTable,
      env: stackEnv,
      stackName: `${this.stackNamePrefix}-api`
    });
    this.apiStack.addDependency(this.authStack);
    this.apiStack.addDependency(this.storageStack);
  }
}

function toPascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}
