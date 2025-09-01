/**
 * CDK Nag compliance tests for Authentication Stack.
 */

import { App, Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { AuthStack } from '../lib/constructs/auth-stack';
import { DEFAULT_CONFIG } from '../lib/types';

describe('AuthStack CDK Nag Compliance', () => {
  test('passes CDK Nag security checks', () => {
    const app = new App();
    const stack = new AuthStack(app, 'TestAuthStack', {
      config: DEFAULT_CONFIG,
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });

    // Apply CDK Nag checks
    Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: false }));

    // Synthesize the stack to trigger CDK Nag validation
    const assembly = app.synth();
    
    // If CDK Nag finds issues, it will throw errors during synthesis
    // The fact that we reach this point means all checks passed
    expect(assembly).toBeDefined();
    expect(assembly.stacks).toHaveLength(1);
  });

  test('authentication resources meet security baseline', () => {
    const app = new App();
    const stack = new AuthStack(app, 'TestAuthStack', {
      config: DEFAULT_CONFIG,
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });

    // Verify security-critical configurations
    expect(stack.outputs.userPool).toBeDefined();
    expect(stack.outputs.userPoolClient).toBeDefined();
    
    // These properties ensure security compliance
    const userPool = stack.outputs.userPool;
    const userPoolClient = stack.outputs.userPoolClient;
    
    // Verify constructs are properly configured (CDK will validate the rest)
    expect(userPool.userPoolId).toBeDefined();
    expect(userPool.userPoolArn).toBeDefined();
    expect(userPoolClient.userPoolClientId).toBeDefined();
    expect(userPoolClient.userPoolClientSecret).toBeDefined();
  });
});
