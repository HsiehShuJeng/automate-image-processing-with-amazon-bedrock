import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { NotificationStack } from '../lib/constructs/notification-stack';
import { DEFAULT_CONFIG } from '../lib/types';

describe('NotificationStack CloudFormation Template', () => {
  test('matches expected structure', () => {
    const app = new App();
    const stack = new NotificationStack(app, 'TestNotificationStack', {
      config: {
        ...DEFAULT_CONFIG,
        notificationEmail: 'alerts@example.com'
      },
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });

    const template = Template.fromStack(stack);
    expect(template.toJSON()).toMatchSnapshot();
  });
});
