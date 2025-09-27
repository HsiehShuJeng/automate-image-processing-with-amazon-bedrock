import { App } from 'aws-cdk-lib';
import { Stack } from 'aws-cdk-lib';
import { ImageProcessingStage } from '../lib/image-processing-stack';
import { DEFAULT_CONFIG } from '../lib/types';

describe('ImageProcessingStage', () => {
  test('composes all infrastructure stacks', () => {
    const app = new App();
    const stage = new ImageProcessingStage(app, 'TestStage', {
      config: DEFAULT_CONFIG,
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });

    const storage = stage.node.tryFindChild('StorageStack');
    const auth = stage.node.tryFindChild('AuthStack');
    const notification = stage.node.tryFindChild('NotificationStack');
    const compute = stage.node.tryFindChild('ComputeStack');
    const orchestration = stage.node.tryFindChild('OrchestrationStack');
    const api = stage.node.tryFindChild('ApiStack');

    expect(storage).toBeInstanceOf(Stack);
    expect(auth).toBeInstanceOf(Stack);
    expect(notification).toBeInstanceOf(Stack);
    expect(compute).toBeInstanceOf(Stack);
    expect(orchestration).toBeInstanceOf(Stack);
    expect(api).toBeInstanceOf(Stack);
  });

  test('sets up cross-stack dependencies for workflow execution', () => {
    const app = new App();
    const stage = new ImageProcessingStage(app, 'DependencyStage', {
      config: DEFAULT_CONFIG,
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });

    const storageStack = stage.storageStack;
    const notificationStack = stage.notificationStack;
    const computeStack = stage.computeStack;
    const orchestrationStack = stage.orchestrationStack;
    const apiStack = stage.apiStack;

    expect(computeStack.dependencies).toEqual(
      expect.arrayContaining([storageStack, notificationStack])
    );
    expect(orchestrationStack.dependencies).toEqual(
      expect.arrayContaining([computeStack, storageStack, notificationStack])
    );
    expect(apiStack.dependencies).toEqual(expect.arrayContaining([storageStack, stage.authStack]));
  });
});
