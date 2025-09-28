/**
 * Comprehensive tests for Storage Stack following CDK test guidelines.
 */

import { App } from 'aws-cdk-lib';
import { Template, Match, Capture } from 'aws-cdk-lib/assertions';
import { StorageStack } from '../lib/constructs/storage-stack';
import { DEFAULT_CONFIG } from '../lib/types';

describe('StorageStack', () => {
  let app: App;
  let stack: StorageStack;
  let template: Template;

  // Common setup - refactored as per guideline #2
  beforeEach(() => {
    app = new App();
    stack = new StorageStack(app, 'TestStorageStack', {
      config: DEFAULT_CONFIG,
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });
    template = Template.fromStack(stack);
  });

  describe('S3 Bucket Configuration', () => {
    test('creates S3 bucket with correct naming pattern', () => {
      const bucketCapture = new Capture();
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: bucketCapture
      });
      
      // Verify bucket name follows pattern: {bucketName}-bucket-{account}
      expect(bucketCapture.asString()).toMatch(/^image-processing-bucket-123456789012$/);
    });

    test('enables S3 encryption with AES256', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [{
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256'
            }
          }]
        }
      });
    });

    test('enables versioning for S3 bucket', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        VersioningConfiguration: {
          Status: 'Enabled'
        }
      });
    });

    test('blocks all public access to S3 bucket', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true
        }
      });
    });

    test('creates exactly one S3 bucket', () => {
      template.resourceCountIs('AWS::S3::Bucket', 1);
    });
  });

  describe('DynamoDB ImagesTable Configuration', () => {
    test('creates ImagesTable with correct schema', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'ImagesTable',
        KeySchema: [{
          AttributeName: 'Id',
          KeyType: 'HASH'
        }],
        AttributeDefinitions: [{
          AttributeName: 'Id',
          AttributeType: 'S'
        }]
      });
    });

    test('enables DynamoDB stream with NEW_IMAGE view', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'ImagesTable',
        StreamSpecification: {
          StreamViewType: 'NEW_IMAGE'
        }
      });
    });

    test('uses PAY_PER_REQUEST billing mode for ImagesTable', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'ImagesTable',
        BillingMode: 'PAY_PER_REQUEST'
      });
    });

    test('enables encryption for ImagesTable', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'ImagesTable',
        SSESpecification: {
          SSEEnabled: true
        }
      });
    });
  });

  describe('DynamoDB StatusTable Configuration', () => {
    test('creates StatusTable with composite key schema', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'StatusTable',
        KeySchema: [
          { AttributeName: 'Id', KeyType: 'HASH' },
          { AttributeName: 'ImageName', KeyType: 'RANGE' }
        ],
        AttributeDefinitions: [
          { AttributeName: 'Id', AttributeType: 'S' },
          { AttributeName: 'ImageName', AttributeType: 'S' }
        ]
      });
    });

    test('uses PAY_PER_REQUEST billing mode for StatusTable', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'StatusTable',
        BillingMode: 'PAY_PER_REQUEST'
      });
    });

    test('enables encryption for StatusTable', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'StatusTable',
        SSESpecification: {
          SSEEnabled: true
        }
      });
    });

    test('does not enable stream for StatusTable', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'StatusTable',
        StreamSpecification: Match.absent()
      });
    });
  });

  describe('Resource Count Validation', () => {
    test('creates exactly two DynamoDB tables', () => {
      template.resourceCountIs('AWS::DynamoDB::Table', 2);
    });

    test('creates expected total resource count', () => {
      // S3 bucket + 2 DynamoDB tables = 3 main resources
      const resourceCount = Object.keys(template.toJSON().Resources).length;
      expect(resourceCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Resource Policies', () => {
    test('enforces TLS on the S3 bucket', () => {
      template.hasResourceProperties('AWS::S3::BucketPolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Deny',
              Condition: {
                Bool: {
                  'aws:SecureTransport': 'false'
                }
              }
            })
          ])
        }
      });
    });

    test('restricts S3 bucket access to the owning account', () => {
      template.hasResourceProperties('AWS::S3::BucketPolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Condition: Match.objectLike({
                StringNotEquals: {
                  'aws:PrincipalAccount': '123456789012'
                }
              })
            })
          ])
        }
      });
    });

    test('restricts DynamoDB ImagesTable access to secure transport and same account', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'ImagesTable',
        ResourcePolicy: Match.objectLike({
          PolicyDocument: Match.objectLike({
            Statement: Match.arrayWith([
              Match.objectLike({
                Condition: Match.objectLike({
                  Bool: { 'aws:SecureTransport': 'false' }
                })
              }),
              Match.objectLike({
                Condition: Match.objectLike({
                  StringNotEquals: {
                    'aws:PrincipalAccount': '123456789012'
                  }
                })
              })
            ])
          })
        })
      });
    });

    test('restricts DynamoDB StatusTable access to secure transport and same account', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'StatusTable',
        ResourcePolicy: Match.objectLike({
          PolicyDocument: Match.objectLike({
            Statement: Match.arrayWith([
              Match.objectLike({
                Condition: Match.objectLike({
                  Bool: { 'aws:SecureTransport': 'false' }
                })
              }),
              Match.objectLike({
                Condition: Match.objectLike({
                  StringNotEquals: {
                    'aws:PrincipalAccount': '123456789012'
                  }
                })
              })
            ])
          })
        })
      });
    });
  });

  describe('Stack Outputs Validation', () => {
    test('exports storage resources through outputs interface', () => {
      expect(stack.outputs).toBeDefined();
      expect(stack.outputs.bucket).toBeDefined();
      expect(stack.outputs.imagesTable).toBeDefined();
      expect(stack.outputs.statusTable).toBeDefined();
    });

    test('bucket output has correct properties', () => {
      // CDK uses tokens for dynamic values, so we check the construct properties instead
      expect(stack.outputs.bucket).toBeDefined();
      expect(stack.outputs.bucket.bucketName).toBeDefined();
    });

    test('imagesTable output has stream ARN', () => {
      expect(stack.outputs.imagesTable.tableStreamArn).toBeDefined();
    });

    test('statusTable output does not have stream ARN', () => {
      expect(stack.outputs.statusTable.tableStreamArn).toBeUndefined();
    });
  });
});
