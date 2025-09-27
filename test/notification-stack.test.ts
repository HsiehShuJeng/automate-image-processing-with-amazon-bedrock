import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { NotificationStack } from '../lib/constructs/notification-stack';
import { DEFAULT_CONFIG } from '../lib/types';

describe('NotificationStack', () => {
  const baseEnv = { account: '123456789012', region: 'ap-northeast-1' };

  const createStack = (notificationEmail: string = 'alerts@example.com') => {
    const app = new App();
    const stack = new NotificationStack(app, 'TestNotificationStack', {
      config: {
        ...DEFAULT_CONFIG,
        notificationEmail
      },
      env: baseEnv
    });

    return { stack, template: Template.fromStack(stack) };
  };

  test('creates a customer managed KMS key with rotation enabled', () => {
    const { template } = createStack();

    template.hasResourceProperties('AWS::KMS::Key', {
      EnableKeyRotation: true
    });
  });

  test('creates SNS topic with encryption and expected topic name', () => {
    const { template } = createStack();

    template.hasResourceProperties('AWS::SNS::Topic', {
      TopicName: DEFAULT_CONFIG.snsTopicName,
      KmsMasterKeyId: Match.anyValue()
    });
  });

  test('adds email-json subscription when notification email is provided', () => {
    const { template } = createStack('team@example.com');

    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email-json',
      Endpoint: 'team@example.com'
    });
  });

  test('omits subscription when notification email is empty', () => {
    const { template } = createStack('');

    template.resourceCountIs('AWS::SNS::Subscription', 0);
  });

  test('exposes topic through stack outputs interface', () => {
    const { stack } = createStack();

    expect(stack.outputs.topic.topicArn).toBeDefined();
  });
});
