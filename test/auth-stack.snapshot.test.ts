/**
 * Snapshot tests for Authentication Stack CloudFormation template validation.
 */

import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AuthStack } from '../lib/constructs/auth-stack';
import { DEFAULT_CONFIG } from '../lib/types';

describe('AuthStack CloudFormation Template', () => {
  test('matches expected CloudFormation template structure', () => {
    const app = new App();
    const stack = new AuthStack(app, 'TestAuthStack', {
      config: DEFAULT_CONFIG,
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });

    const template = Template.fromStack(stack);
    
    // Snapshot test for template structure validation
    expect(template.toJSON()).toMatchSnapshot();
  });
});
