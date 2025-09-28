#!/usr/bin/env node

/**
 * Storage Stack for the Image Processing application.
 * Contains S3 bucket and DynamoDB tables.
 */

import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { StorageStackProps, StorageStackOutputs } from '../types';
import { applyCdkNag, SecuritySuppressions } from '../utils';

export class StorageStack extends Stack {
  public readonly outputs: StorageStackOutputs;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    // Create S3 bucket for image storage
    const bucket = new s3.Bucket(this, 'ImageBucket', {
      bucketName: `${props.config.bucketName}-bucket-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY, // For development - change for production
      autoDeleteObjects: true // For development - change for production
    });

    bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'DenyInsecureTransport',
        effect: iam.Effect.DENY,
        actions: ['s3:*'],
        principals: [new iam.AnyPrincipal()],
        resources: [bucket.bucketArn, bucket.arnForObjects('*')],
        conditions: {
          Bool: {
            'aws:SecureTransport': 'false'
          }
        }
      })
    );

    bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'RestrictBucketAccessToAccount',
        effect: iam.Effect.DENY,
        actions: ['s3:*'],
        principals: [new iam.AnyPrincipal()],
        resources: [bucket.bucketArn, bucket.arnForObjects('*')],
        conditions: {
          StringNotEquals: {
            'aws:PrincipalAccount': this.account
          }
        }
      })
    );

    const imagesTableName = 'ImagesTable';
    const statusTableName = 'StatusTable';

    // Create ImagesTable with stream enabled
    const imagesTable = new dynamodb.Table(this, 'ImagesTable', {
      tableName: imagesTableName,
      partitionKey: { name: 'Id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      removalPolicy: RemovalPolicy.DESTROY // For development - change for production
    });

    const imagesTableArn = this.formatArn({
      service: 'dynamodb',
      resource: 'table',
      resourceName: imagesTableName
    });

    const imagesTablePolicy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          sid: 'DenyImagesTableInsecureTransport',
          effect: iam.Effect.DENY,
          actions: ['dynamodb:*'],
          principals: [new iam.AnyPrincipal()],
          resources: [imagesTableArn],
          conditions: {
            Bool: {
              'aws:SecureTransport': 'false'
            }
          }
        }),
        new iam.PolicyStatement({
          sid: 'RestrictImagesTableAccessToAccount',
          effect: iam.Effect.DENY,
          actions: ['dynamodb:*'],
          principals: [new iam.AnyPrincipal()],
          resources: [imagesTableArn],
          conditions: {
            StringNotEquals: {
              'aws:PrincipalAccount': this.account
            }
          }
        })
      ]
    });
    const imagesTableCfn = imagesTable.node.defaultChild as dynamodb.CfnTable;
    imagesTableCfn.resourcePolicy = {
      policyDocument: imagesTablePolicy.toJSON()
    };

    // Create StatusTable with composite key
    const statusTable = new dynamodb.Table(this, 'StatusTable', {
      tableName: statusTableName,
      partitionKey: { name: 'Id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'ImageName', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY // For development - change for production
    });

    const statusTableArn = this.formatArn({
      service: 'dynamodb',
      resource: 'table',
      resourceName: statusTableName
    });

    const statusTablePolicy = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          sid: 'DenyStatusTableInsecureTransport',
          effect: iam.Effect.DENY,
          actions: ['dynamodb:*'],
          principals: [new iam.AnyPrincipal()],
          resources: [statusTableArn],
          conditions: {
            Bool: {
              'aws:SecureTransport': 'false'
            }
          }
        }),
        new iam.PolicyStatement({
          sid: 'RestrictStatusTableAccessToAccount',
          effect: iam.Effect.DENY,
          actions: ['dynamodb:*'],
          principals: [new iam.AnyPrincipal()],
          resources: [statusTableArn],
          conditions: {
            StringNotEquals: {
              'aws:PrincipalAccount': this.account
            }
          }
        })
      ]
    });
    const statusTableCfn = statusTable.node.defaultChild as dynamodb.CfnTable;
    statusTableCfn.resourcePolicy = {
      policyDocument: statusTablePolicy.toJSON()
    };

    // Apply CDK Nag security checks
    applyCdkNag(this);
    SecuritySuppressions.applyCommonSuppressions(this, 'Storage Stack');
    SecuritySuppressions.applyS3Suppressions(this);

    // Export outputs
    this.outputs = {
      bucket,
      imagesTable,
      statusTable
    };
  }
}
