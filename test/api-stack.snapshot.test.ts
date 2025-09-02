/**
 * Snapshot tests for API Stack CloudFormation template validation.
 */

import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ApiStack } from '../lib/constructs/api-stack';
import { StorageStack } from '../lib/constructs/storage-stack';
import { AuthStack } from '../lib/constructs/auth-stack';
import { DEFAULT_CONFIG } from '../lib/types';

describe('ApiStack CloudFormation Template', () => {
  test('matches expected CloudFormation template structure', () => {
    const app = new App();
    
    // Create dependency stacks
    const storageStack = new StorageStack(app, 'TestStorageStack', {
      config: DEFAULT_CONFIG,
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });
    
    const authStack = new AuthStack(app, 'TestAuthStack', {
      config: DEFAULT_CONFIG,
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });
    
    const apiStack = new ApiStack(app, 'TestApiStack', {
      config: DEFAULT_CONFIG,
      userPool: authStack.outputs.userPool,
      imagesTable: storageStack.outputs.imagesTable,
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });

    const template = Template.fromStack(apiStack);
    
    // Snapshot test for template structure validation
    expect(template.toJSON()).toMatchSnapshot();
  });
});
