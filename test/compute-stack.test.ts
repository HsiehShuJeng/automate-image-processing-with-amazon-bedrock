/**
 * Comprehensive tests for Compute Stack following CDK test guidelines.
 */

import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ComputeStack } from '../lib/constructs/compute-stack';
import { StorageStack } from '../lib/constructs/storage-stack';
import { DEFAULT_CONFIG } from '../lib/types';

describe('ComputeStack', () => {
  let app: App;
  let storageStack: StorageStack;
  let computeStack: ComputeStack;
  let template: Template;

  // Common setup - refactored as per CDK test guidelines
  beforeEach(() => {
    app = new App();
    
    // Create dependency stack
    storageStack = new StorageStack(app, 'TestStorageStack', {
      config: DEFAULT_CONFIG,
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });
    
    // Create Compute stack with dependencies
    computeStack = new ComputeStack(app, 'TestComputeStack', {
      config: DEFAULT_CONFIG,
      bucket: storageStack.outputs.bucket,
      imagesTable: storageStack.outputs.imagesTable,
      statusTable: storageStack.outputs.statusTable,
      snsTopic: undefined as any, // Will be created in workflow stack
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });
    
    template = Template.fromStack(computeStack);
  });

  describe('Lambda Functions Configuration', () => {
    test('creates StartImageProcessingWorkflowFunction with correct timeout', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'app.lambda_handler',
        Runtime: 'python3.13',
        Timeout: 120, // Specific timeout per SAM template
        MemorySize: 128
      });
    });

    test('creates BuildBedrockRequestFunction with correct configuration', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'app.lambda_handler',
        Runtime: 'python3.13',
        Timeout: 900, // Global timeout per SAM template
        MemorySize: 512,
        EphemeralStorage: {
          Size: 1024
        }
      });
    });

    test('creates ParseBedrockResponseFunction with correct configuration', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'app.lambda_handler',
        Runtime: 'python3.13',
        Timeout: 900, // Global timeout per SAM template
        MemorySize: 512,
        EphemeralStorage: {
          Size: 1024
        }
      });
    });

    test('creates GenerateStatusReportFunction with correct timeout', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'app.lambda_handler',
        Runtime: 'python3.13',
        Timeout: 900, // Global timeout per SAM template
        MemorySize: 128
      });
    });

    test('creates exactly four Lambda functions', () => {
      template.resourceCountIs('AWS::Lambda::Function', 4);
    });
  });

  describe('Environment Variables Configuration', () => {
    test('configures StartWorkflowFunction environment variables', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            INPUT_BUCKET: Match.anyValue(),
            IMAGE_PREFIX: DEFAULT_CONFIG.imagePrefix,
            GENERATED_IMAGE_PREFIX: DEFAULT_CONFIG.generatedImagePrefix,
            STATUS_REPORT_PREFIX: DEFAULT_CONFIG.statusReportPrefix
          }
        }
      });
    });

    test('configures StatusReportFunction environment variables', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            STATUS_TABLE: Match.anyValue(),
            STATUS_REPORT_URL_EXPIRATION: DEFAULT_CONFIG.statusReportUrlExpiration.toString()
          }
        }
      });
    });
  });

  describe('IAM Permissions Configuration', () => {
    test('grants S3 permissions to Lambda functions', () => {
      // Check that S3 permissions are granted by examining the policies
      const policies = template.toJSON().Resources;
      const s3Policies = Object.values(policies).filter((resource: any) => 
        resource.Type === 'AWS::IAM::Policy' && 
        JSON.stringify(resource).includes('s3:GetObject')
      );
      expect(s3Policies.length).toBeGreaterThan(0);
    });

    test('grants DynamoDB read permissions to StatusReportFunction', () => {
      // Check that DynamoDB permissions are granted (CDK may combine with S3 permissions)
      const policies = template.toJSON().Resources;
      const statusReportPolicy = Object.values(policies).find((resource: any) => 
        resource.Type === 'AWS::IAM::Policy' && 
        resource.Properties?.PolicyName?.includes('GenerateStatusReportFunction')
      ) as any;
      
      expect(statusReportPolicy).toBeDefined();
      const statements = statusReportPolicy.Properties.PolicyDocument.Statement;
      const hasDynamoPermissions = statements.some((stmt: any) => 
        stmt.Action?.some((action: string) => action.includes('dynamodb:'))
      );
      expect(hasDynamoPermissions).toBe(true);
    });

    test('creates IAM roles for Lambda functions', () => {
      // Should create at least 4 IAM roles (one per Lambda function)
      const roleCount = Object.keys(template.toJSON().Resources).filter(
        key => template.toJSON().Resources[key].Type === 'AWS::IAM::Role'
      ).length;
      expect(roleCount).toBeGreaterThanOrEqual(4);
    });
  });

  describe('DynamoDB Stream Integration', () => {
    test('creates DynamoDB event source mapping for StartWorkflowFunction', () => {
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        BatchSize: 1,
        StartingPosition: 'LATEST'
      });
    });

    test('event source mapping references correct DynamoDB table stream', () => {
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        EventSourceArn: {
          'Fn::ImportValue': Match.stringLikeRegexp('.*ImagesTable.*StreamArn.*')
        }
      });
    });

    test('event source mapping targets StartWorkflowFunction', () => {
      template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
        FunctionName: {
          Ref: Match.stringLikeRegexp('.*StartImageProcessingWorkflowFunction.*')
        }
      });
    });

    test('creates exactly one event source mapping', () => {
      template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);
    });
  });

  describe('Stack Outputs Validation', () => {
    test('exports compute resources through outputs interface', () => {
      expect(computeStack.outputs).toBeDefined();
      expect(computeStack.outputs.startWorkflowFunction).toBeDefined();
      expect(computeStack.outputs.buildRequestFunction).toBeDefined();
      expect(computeStack.outputs.parseResponseFunction).toBeDefined();
      expect(computeStack.outputs.statusReportFunction).toBeDefined();
    });

    test('Lambda function outputs have correct properties', () => {
      expect(computeStack.outputs.startWorkflowFunction.functionArn).toBeDefined();
      expect(computeStack.outputs.buildRequestFunction.functionArn).toBeDefined();
      expect(computeStack.outputs.parseResponseFunction.functionArn).toBeDefined();
      expect(computeStack.outputs.statusReportFunction.functionArn).toBeDefined();
    });
  });
});
