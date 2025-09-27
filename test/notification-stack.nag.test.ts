import { App, Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { NotificationStack } from '../lib/constructs/notification-stack';
import { DEFAULT_CONFIG } from '../lib/types';

describe('NotificationStack CDK Nag Compliance', () => {
  test('passes AwsSolutions checks', () => {
    const app = new App();
    const stack = new NotificationStack(app, 'TestNotificationStack', {
      config: {
        ...DEFAULT_CONFIG,
        notificationEmail: 'alerts@example.com'
      },
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });

    Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: false }));

    expect(() => app.synth()).not.toThrow();
  });
});
