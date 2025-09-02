/**
 * Integration tests for API Stack following CDK test guidelines.
 */

import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ApiStack } from '../lib/constructs/api-stack';
import { StorageStack } from '../lib/constructs/storage-stack';
import { AuthStack } from '../lib/constructs/auth-stack';
import { DEFAULT_CONFIG } from '../lib/types';

describe('ApiStack Integration Tests', () => {
  let app: App;
  let storageStack: StorageStack;
  let authStack: AuthStack;
  let apiStack: ApiStack;
  let template: Template;

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

  describe('Cognito Authorizer Integration', () => {
    test('authorizer references correct User Pool ARN', () => {
      template.hasResourceProperties('AWS::ApiGateway::Authorizer', {
        Type: 'COGNITO_USER_POOLS',
        ProviderARNs: [{
          'Fn::ImportValue': Match.stringLikeRegexp('.*UserPool.*Arn.*')
        }]
      });
    });

    test('API methods use Cognito authorizer', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        AuthorizationType: 'COGNITO_USER_POOLS',
        AuthorizerId: {
          Ref: Match.stringLikeRegexp('.*CognitoAuthorizer.*')
        }
      });
    });

    test('authorizer has correct identity source', () => {
      template.hasResourceProperties('AWS::ApiGateway::Authorizer', {
        IdentitySource: 'method.request.header.Authorization'
      });
    });
  });

  describe('DynamoDB Integration', () => {
    test('images endpoint integrates with correct DynamoDB table', () => {
      // Check that there's a role with DynamoDB PutItem permission
      const resources = template.toJSON().Resources;
      const dynamoRole = Object.values(resources).find((resource: any) => 
        resource.Type === 'AWS::IAM::Role' && 
        resource.Properties?.Policies?.some((policy: any) => 
          policy.PolicyDocument?.Statement?.some((stmt: any) => 
            stmt.Action === 'dynamodb:PutItem'
          )
        )
      );
      expect(dynamoRole).toBeDefined();
    });

    test('DynamoDB integration has correct request parameters', () => {
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

    test('DynamoDB integration has VTL request template', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        Integration: {
          RequestTemplates: {
            'application/json': Match.stringLikeRegexp('.*TableName.*ImagesTable.*')
          }
        }
      });
    });
  });

  describe('Rekognition Integration', () => {
    test('detectLabels endpoint has correct Rekognition integration', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        Policies: [{
          PolicyDocument: {
            Statement: Match.arrayWith([{
              Effect: 'Allow',
              Action: 'rekognition:DetectLabels',
              Resource: '*'
            }])
          }
        }]
      });
    });

    test('Rekognition integration has correct request parameters', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        Integration: {
          Type: 'AWS',
          IntegrationHttpMethod: 'POST',
          RequestParameters: {
            'integration.request.header.Content-Type': "'application/x-amz-json-1.1'",
            'integration.request.header.X-Amz-Target': "'RekognitionService.DetectLabels'"
          }
        }
      });
    });
  });

  describe('CORS Configuration', () => {
    test('API has CORS enabled', () => {
      // CDK creates OPTIONS methods for CORS
      const resources = template.toJSON().Resources;
      const optionsMethods = Object.values(resources).filter((resource: any) => 
        resource.Type === 'AWS::ApiGateway::Method' && 
        resource.Properties?.HttpMethod === 'OPTIONS'
      );
      expect(optionsMethods.length).toBeGreaterThan(0);
    });

    test('CORS allows required headers', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'OPTIONS',
        Integration: {
          IntegrationResponses: [{
            ResponseParameters: {
              'method.response.header.Access-Control-Allow-Headers': Match.stringLikeRegexp('.*Authorization.*')
            }
          }]
        }
      });
    });
  });

  describe('API Gateway Configuration', () => {
    test('API has correct name and description', () => {
      template.hasResourceProperties('AWS::ApiGateway::RestApi', {
        Name: DEFAULT_CONFIG.apiName,
        Description: Match.stringLikeRegexp('.*Image Processing API.*')
      });
    });

    test('API resources have correct path parts', () => {
      template.hasResourceProperties('AWS::ApiGateway::Resource', {
        PathPart: 'detectLabels'
      });
      
      template.hasResourceProperties('AWS::ApiGateway::Resource', {
        PathPart: 'images'
      });
    });

    test('methods have proper response configurations', () => {
      template.hasResourceProperties('AWS::ApiGateway::Method', {
        MethodResponses: [{
          StatusCode: '200'
        }],
        Integration: {
          IntegrationResponses: [{
            StatusCode: '200'
          }]
        }
      });
    });
  });

  describe('Security Configuration', () => {
    test('IAM roles follow least privilege principle', () => {
      // Rekognition role should only have DetectLabels permission
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

    test('DynamoDB role has minimal required permissions', () => {
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

    test('service roles can only be assumed by API Gateway', () => {
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
  });
});
