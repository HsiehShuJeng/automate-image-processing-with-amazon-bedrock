import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as sns from 'aws-cdk-lib/aws-sns';
import { StorageStack } from '../../lib/constructs/storage-stack';
import { ComputeStack } from '../../lib/constructs/compute-stack';
import { OrchestrationStack } from '../../lib/constructs/orchestration-stack';
import { DEFAULT_CONFIG, ImageProcessingConfig } from '../../lib/types';

export interface OrchestrationTestContext {
  readonly app: App;
  readonly storageStack: StorageStack;
  readonly computeStack: ComputeStack;
  readonly orchestrationStack: OrchestrationStack;
  readonly template: Template;
  readonly config: ImageProcessingConfig;
}

export function createOrchestrationTestContext(): OrchestrationTestContext {
  const app = new App();
  const env = { account: '123456789012', region: 'us-east-1' };
  const config: ImageProcessingConfig = {
    ...DEFAULT_CONFIG,
    notificationEmail: 'test@example.com'
  };

  const storageStack = new StorageStack(app, 'TestStorageStack', { config, env });
  const topicStack = new Stack(app, 'TestTopicStack', { env });
  const topic = new sns.Topic(topicStack, 'TestNotificationTopic');

  const computeStack = new ComputeStack(app, 'TestComputeStack', {
    config,
    bucket: storageStack.outputs.bucket,
    imagesTable: storageStack.outputs.imagesTable,
    statusTable: storageStack.outputs.statusTable,
    snsTopic: topic,
    env
  });

  const orchestrationStack = new OrchestrationStack(app, 'TestOrchestrationStack', {
    config,
    bucket: storageStack.outputs.bucket,
    statusTable: storageStack.outputs.statusTable,
    snsTopic: topic,
    computeFunctions: computeStack.outputs,
    env
  });

  const template = Template.fromStack(orchestrationStack);

  return {
    app,
    storageStack,
    computeStack,
    orchestrationStack,
    template,
    config
  };
}
