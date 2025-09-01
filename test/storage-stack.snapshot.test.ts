/**
 * Snapshot tests for Storage Stack CloudFormation template validation.
 * Used sparingly as per CDK test guidelines.
 */

import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { StorageStack } from '../lib/constructs/storage-stack';
import { DEFAULT_CONFIG } from '../lib/types';

describe('StorageStack CloudFormation Template', () => {
  test('matches expected CloudFormation template structure', () => {
    const app = new App();
    const stack = new StorageStack(app, 'TestStorageStack', {
      config: DEFAULT_CONFIG,
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });

    const template = Template.fromStack(stack);
    
    // Snapshot test for template structure validation
    // This ensures the CloudFormation template structure remains consistent
    expect(template.toJSON()).toMatchSnapshot();
  });
});
