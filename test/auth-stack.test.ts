/**
 * Comprehensive tests for Authentication Stack following CDK test guidelines.
 */

import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AuthStack } from '../lib/constructs/auth-stack';
import { DEFAULT_CONFIG } from '../lib/types';

describe('AuthStack', () => {
  let app: App;
  let stack: AuthStack;
  let template: Template;

  // Common setup - refactored as per CDK test guidelines
  beforeEach(() => {
    app = new App();
    stack = new AuthStack(app, 'TestAuthStack', {
      config: DEFAULT_CONFIG,
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });
    template = Template.fromStack(stack);
  });

  describe('Cognito User Pool Configuration', () => {
    test('creates User Pool with email verification', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        AutoVerifiedAttributes: ['email'],
        UsernameAttributes: ['email']
      });
    });

    test('disables self sign-up (admin create only)', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        AdminCreateUserConfig: {
          AllowAdminCreateUserOnly: true
        }
      });
    });

    test('configures password policy with complexity requirements', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        Policies: {
          PasswordPolicy: {
            MinimumLength: 8,
            RequireLowercase: true,
            RequireNumbers: true,
            RequireSymbols: true,
            RequireUppercase: true
          }
        }
      });
    });

    test('sets correct deletion policy for development', () => {
      template.hasResource('AWS::Cognito::UserPool', {
        DeletionPolicy: 'Delete',
        UpdateReplacePolicy: 'Delete'
      });
    });

    test('creates exactly one User Pool', () => {
      template.resourceCountIs('AWS::Cognito::UserPool', 1);
    });
  });

  describe('Cognito User Pool Client Configuration', () => {
    test('creates User Pool Client with secret generation', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        GenerateSecret: true
      });
    });

    test('enables appropriate auth flows', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        ExplicitAuthFlows: Match.arrayWith([
          'ALLOW_USER_PASSWORD_AUTH',
          'ALLOW_USER_SRP_AUTH',
          'ALLOW_REFRESH_TOKEN_AUTH'
        ])
      });
    });

    test('associates client with User Pool', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        UserPoolId: {
          Ref: Match.stringLikeRegexp('UserPool.*')
        }
      });
    });

    test('creates exactly one User Pool Client', () => {
      template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
    });
  });

  describe('Security and Compliance Validation', () => {
    test('enforces strong password requirements', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        Policies: {
          PasswordPolicy: {
            MinimumLength: Match.anyValue(),
            RequireLowercase: true,
            RequireNumbers: true,
            RequireSymbols: true,
            RequireUppercase: true
          }
        }
      });
    });

    test('requires admin-only user creation for security', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        AdminCreateUserConfig: {
          AllowAdminCreateUserOnly: true
        }
      });
    });

    test('enables email verification for account security', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        AutoVerifiedAttributes: Match.arrayWith(['email'])
      });
    });
  });

  describe('OAuth and Authentication Flow Validation', () => {
    test('enables SRP authentication flow', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_SRP_AUTH'])
      });
    });

    test('enables password authentication flow', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_PASSWORD_AUTH'])
      });
    });

    test('enables refresh token flow', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        ExplicitAuthFlows: Match.arrayWith(['ALLOW_REFRESH_TOKEN_AUTH'])
      });
    });
  });

  describe('Resource Count Validation', () => {
    test('creates expected total resource count', () => {
      // User Pool + User Pool Client = 2 main resources
      const resourceCount = Object.keys(template.toJSON().Resources).length;
      expect(resourceCount).toBeGreaterThanOrEqual(2);
    });

    test('does not create unexpected resources', () => {
      // Should only have Cognito resources, no API Gateway authorizer
      template.resourceCountIs('AWS::ApiGateway::Authorizer', 0);
    });
  });

  describe('Stack Outputs Validation', () => {
    test('exports authentication resources through outputs interface', () => {
      expect(stack.outputs).toBeDefined();
      expect(stack.outputs.userPool).toBeDefined();
      expect(stack.outputs.userPoolClient).toBeDefined();
    });

    test('user pool output has correct properties', () => {
      expect(stack.outputs.userPool.userPoolId).toBeDefined();
      expect(stack.outputs.userPool.userPoolArn).toBeDefined();
    });

    test('user pool client output has correct properties', () => {
      expect(stack.outputs.userPoolClient.userPoolClientId).toBeDefined();
    });

    test('user pool client secret is accessible', () => {
      // Verify the client secret can be accessed (though it's a token in tests)
      expect(stack.outputs.userPoolClient.userPoolClientSecret).toBeDefined();
    });
  });

  describe('Integration Readiness Validation', () => {
    test('user pool is ready for API Gateway authorizer integration', () => {
      expect(stack.outputs.userPool.userPoolArn).toBeDefined();
      expect(stack.outputs.userPool.userPoolId).toBeDefined();
    });

    test('user pool client is ready for application integration', () => {
      expect(stack.outputs.userPoolClient.userPoolClientId).toBeDefined();
      expect(stack.outputs.userPoolClient.userPoolClientSecret).toBeDefined();
    });
  });
});
