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
import { MonitoringStack } from './constructs/monitoring-stack';

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
  /**
   * Whether termination protection should be enabled for stacks in the stage.
   */
  readonly terminationProtection?: boolean;
}

export class ImageProcessingStage extends Stage {
  public readonly storageStack: StorageStack;
  public readonly authStack: AuthStack;
  public readonly notificationStack: NotificationStack;
  public readonly computeStack: ComputeStack;
  public readonly orchestrationStack: OrchestrationStack;
  public readonly apiStack: ApiStack;
  public readonly monitoringStack: MonitoringStack;
  public readonly config: ImageProcessingConfig;
  public readonly environmentName: string;
  public readonly stackNamePrefix: string;
  public readonly terminationProtection: boolean;

  constructor(scope: Construct, id: string, props: ImageProcessingStageProps = {}) {
    super(scope, id, props);

    const baseConfig: ImageProcessingConfig = {
      ...DEFAULT_CONFIG,
      ...(props.config ?? {})
    };

    this.config = baseConfig;

    const cloneConfig = (): ImageProcessingConfig => ({ ...baseConfig });

    this.environmentName = props.environmentName ?? 'dev';
    this.stackNamePrefix = props.stackNamePrefix ?? `ImageProcessing${toPascalCase(this.environmentName)}`;
    this.terminationProtection = props.terminationProtection ?? false;

    const stackEnv = props.env ?? {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1'
    };

    this.storageStack = new StorageStack(this, 'StorageStack', {
      config: cloneConfig(),
      env: stackEnv,
      stackName: `${this.stackNamePrefix}-storage`,
      terminationProtection: this.terminationProtection
    });

    this.authStack = new AuthStack(this, 'AuthStack', {
      config: cloneConfig(),
      env: stackEnv,
      stackName: `${this.stackNamePrefix}-auth`,
      terminationProtection: this.terminationProtection
    });

    this.notificationStack = new NotificationStack(this, 'NotificationStack', {
      config: cloneConfig(),
      env: stackEnv,
      stackName: `${this.stackNamePrefix}-notification`,
      terminationProtection: this.terminationProtection
    });

    this.computeStack = new ComputeStack(this, 'ComputeStack', {
      config: cloneConfig(),
      bucket: this.storageStack.outputs.bucket,
      imagesTable: this.storageStack.outputs.imagesTable,
      statusTable: this.storageStack.outputs.statusTable,
      snsTopic: this.notificationStack.outputs.topic,
      env: stackEnv,
      stackName: `${this.stackNamePrefix}-compute`,
      terminationProtection: this.terminationProtection
    });
    this.computeStack.addDependency(this.storageStack);
    this.computeStack.addDependency(this.notificationStack);

    this.orchestrationStack = new OrchestrationStack(this, 'OrchestrationStack', {
      config: cloneConfig(),
      computeFunctions: this.computeStack.outputs,
      bucket: this.storageStack.outputs.bucket,
      statusTable: this.storageStack.outputs.statusTable,
      snsTopic: this.notificationStack.outputs.topic,
      env: stackEnv,
      stackName: `${this.stackNamePrefix}-orchestration`,
      terminationProtection: this.terminationProtection
    });

    this.apiStack = new ApiStack(this, 'ApiStack', {
      config: cloneConfig(),
      userPool: this.authStack.outputs.userPool,
      imagesTable: this.storageStack.outputs.imagesTable,
      env: stackEnv,
      stackName: `${this.stackNamePrefix}-api`,
      terminationProtection: this.terminationProtection
    });
    this.apiStack.addDependency(this.authStack);
    this.apiStack.addDependency(this.storageStack);

    this.monitoringStack = new MonitoringStack(this, 'MonitoringStack', {
      config: cloneConfig(),
      computeFunctions: this.computeStack.outputs,
      stateMachine: this.orchestrationStack.outputs.stateMachine,
      api: this.apiStack.outputs.api,
      snsTopic: this.notificationStack.outputs.topic,
      bucket: this.storageStack.outputs.bucket,
      env: stackEnv,
      stackName: `${this.stackNamePrefix}-monitoring`,
      terminationProtection: this.terminationProtection
    });
  }
}

function toPascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}
