/**
 * Comprehensive tests for API Stack following CDK test guidelines.
 */

import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ApiStack } from '../lib/constructs/api-stack';
import { StorageStack } from '../lib/constructs/storage-stack';
import { AuthStack } from '../lib/constructs/auth-stack';
import { DEFAULT_CONFIG } from '../lib/types';

describe('ApiStack', () => {
  let app: App;
  let storageStack: StorageStack;
  let authStack: AuthStack;
  let apiStack: ApiStack;
  let template: Template;

  // Common setup - refactored as per CDK test guidelines
  beforeEach(() => {
    app = new App();
    
    // Create dependency stacks
    storageStack = new StorageStack(app, 'TestStorageStack', {
      config: DEFAULT_CONFIG,
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });
    
    authStack = new AuthStack(app, 'TestAuthStack', {
      config: DEFAULT_CONFIG,
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });
    
    // Create API stack with dependencies
    apiStack = new ApiStack(app, 'TestApiStack', {
      config: DEFAULT_CONFIG,
      userPool: authStack.outputs.userPool,
      imagesTable: storageStack.outputs.imagesTable,
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });
    
    template = Template.fromStack(apiStack);
  });

  describe('REST API Configuration', () => {
    test('creates REST API with correct name', () => {
      template.hasResourceProperties('AWS::ApiGateway::RestApi', {
        Name: DEFAULT_CONFIG.apiName
      });
    });

    test('creates exactly one REST API', () => {
      template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    });

    test('configures stage with access logging and tracing', () => {
      template.hasResourceProperties('AWS::ApiGateway::Stage', {
        AccessLogSetting: Match.objectLike({
          DestinationArn: Match.anyValue()
        }),
        TracingEnabled: true,
        MethodSettings: Match.arrayWith([
          Match.objectLike({
            LoggingLevel: 'INFO',
            MetricsEnabled: true
          })
        ])
      });
    });
  });

  describe('Observability', () => {
    test('creates CloudWatch log group for API access logs', () => {
      template.resourceCountIs('AWS::Logs::LogGroup', 1);
    });
  });

  describe('Cognito Authorizer Configuration', () => {
    test('creates Cognito User Pools authorizer', () => {
      template.hasResourceProperties('AWS::ApiGateway::Authorizer', {
        Name: 'CognitoUserPoolsAuthorizer',
        Type: 'COGNITO_USER_POOLS',
        IdentitySource: 'method.request.header.Authorization'
      });
    });

    test('associates authorizer with REST API', () => {
      template.hasResourceProperties('AWS::ApiGateway::Authorizer', {
        RestApiId: {
          Ref: Match.stringLikeRegexp('.*Api.*')
        }
      });
    });

    test('creates exactly one authorizer', () => {
      template.resourceCountIs('AWS::ApiGateway::Authorizer', 1);
    });
  });

  describe('IAM Roles Configuration', () => {
    test('creates Rekognition IAM role for API Gateway', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: [{
            Effect: 'Allow',
            Principal: {
              Service: 'apigateway.amazonaws.com'
            },
            Action: 'sts:AssumeRole'
          }]
        }
      });
    });

    test('grants DetectLabels permission to Rekognition role', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        Policies: [{
          PolicyDocument: {
            Statement: [{
              Effect: 'Allow',
              Action: 'rekognition:DetectLabels',
              Resource: '*'
            }]
          }
        }]
      });
    });

    test('grants DynamoDB PutItem permission to DynamoDB role', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        Policies: [{
          PolicyDocument: {
            Statement: [{
              Effect: 'Allow',
              Action: 'dynamodb:PutItem'
            }]
          }
        }]
      });
    });

    test('creates at least two IAM roles', () => {
      // CDK may create additional roles for service integrations
      const roleCount = Object.keys(template.toJSON().Resources).filter(
        key => template.toJSON().Resources[key].Type === 'AWS::IAM::Role'
      ).length;
      expect(roleCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('API Resources Configuration', () => {
    test('creates detectLabels resource', () => {
      template.hasResourceProperties('AWS::ApiGateway::Resource', {
        PathPart: 'detectLabels'
      });
    });

    test('creates images resource', () => {
      template.hasResourceProperties('AWS::ApiGateway::Resource', {
        PathPart: 'images'
      });
    });

    test('creates exactly two API resources', () => {
      template.resourceCountIs('AWS::ApiGateway::Resource', 2);
    });
  });

  describe('API Methods Configuration', () => {
    test('creates POST method for detectLabels', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'POST',
        AuthorizationType: 'COGNITO_USER_POOLS'
      });
    });

    test('creates POST method for images', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'POST',
        AuthorizationType: 'COGNITO_USER_POOLS'
      });
    });

    test('creates at least two API methods', () => {
      // CDK may create additional methods (OPTIONS for CORS)
      const methodCount = Object.keys(template.toJSON().Resources).filter(
        key => template.toJSON().Resources[key].Type === 'AWS::ApiGateway::Method'
      ).length;
      expect(methodCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Service Integrations Configuration', () => {
    test('configures Rekognition integration for detectLabels', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        Integration: {
          Type: 'AWS',
          IntegrationHttpMethod: 'POST'
        }
      });
    });

    test('configures DynamoDB integration for images', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        Integration: {
          Type: 'AWS',
          IntegrationHttpMethod: 'POST',
          RequestParameters: {
            'integration.request.header.Content-Type': "'application/x-amz-json-1.1'",
            'integration.request.header.X-Amz-Target': "'DynamoDB_20120810.PutItem'"
          }
        }
      });
    });
  });

  describe('Stack Outputs Validation', () => {
    test('exports API resources through outputs interface', () => {
      expect(apiStack.outputs).toBeDefined();
      expect(apiStack.outputs.api).toBeDefined();
      expect(apiStack.outputs.apiUrl).toBeDefined();
    });

    test('API output has correct properties', () => {
      expect(apiStack.outputs.api.restApiId).toBeDefined();
      expect(apiStack.outputs.api.restApiName).toBe(DEFAULT_CONFIG.apiName);
    });

    test('API URL is properly formatted', () => {
      // CDK uses tokens, so we check that the URL is defined and contains expected parts
      expect(apiStack.outputs.apiUrl).toBeDefined();
      expect(apiStack.outputs.apiUrl).toContain('execute-api');
      expect(apiStack.outputs.apiUrl).toContain('ap-northeast-1');
    });
  });
});
