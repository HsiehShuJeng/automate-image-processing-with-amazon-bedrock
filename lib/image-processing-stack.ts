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
}

export class ImageProcessingStage extends Stage {
  public readonly storageStack: StorageStack;
  public readonly authStack: AuthStack;
  public readonly notificationStack: NotificationStack;
  public readonly computeStack: ComputeStack;
  public readonly orchestrationStack: OrchestrationStack;
  public readonly apiStack: ApiStack;
  public readonly config: ImageProcessingConfig;

  constructor(scope: Construct, id: string, props: ImageProcessingStageProps = {}) {
    super(scope, id, props);

    this.config = props.config ?? DEFAULT_CONFIG;

    const stackEnv = props.env ?? {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1'
    };

    this.storageStack = new StorageStack(this, 'StorageStack', {
      config: this.config,
      env: stackEnv
    });

    this.authStack = new AuthStack(this, 'AuthStack', {
      config: this.config,
      env: stackEnv
    });

    this.notificationStack = new NotificationStack(this, 'NotificationStack', {
      config: this.config,
      env: stackEnv
    });

    this.computeStack = new ComputeStack(this, 'ComputeStack', {
      config: this.config,
      bucket: this.storageStack.outputs.bucket,
      imagesTable: this.storageStack.outputs.imagesTable,
      statusTable: this.storageStack.outputs.statusTable,
      snsTopic: this.notificationStack.outputs.topic,
      env: stackEnv
    });
    this.computeStack.addDependency(this.storageStack);
    this.computeStack.addDependency(this.notificationStack);

    this.orchestrationStack = new OrchestrationStack(this, 'OrchestrationStack', {
      config: this.config,
      computeFunctions: this.computeStack.outputs,
      bucket: this.storageStack.outputs.bucket,
      statusTable: this.storageStack.outputs.statusTable,
      snsTopic: this.notificationStack.outputs.topic,
      env: stackEnv
    });
    this.orchestrationStack.addDependency(this.computeStack);
    this.orchestrationStack.addDependency(this.storageStack);
    this.orchestrationStack.addDependency(this.notificationStack);

    this.apiStack = new ApiStack(this, 'ApiStack', {
      config: this.config,
      userPool: this.authStack.outputs.userPool,
      imagesTable: this.storageStack.outputs.imagesTable,
      env: stackEnv
    });
    this.apiStack.addDependency(this.authStack);
    this.apiStack.addDependency(this.storageStack);
  }
}
