#!/usr/bin/env node

/**
 * Storage Stack for the Image Processing application.
 * Contains S3 bucket and DynamoDB tables.
 */

import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
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

    // Create ImagesTable with stream enabled
    const imagesTable = new dynamodb.Table(this, 'ImagesTable', {
      tableName: 'ImagesTable',
      partitionKey: { name: 'Id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      removalPolicy: RemovalPolicy.DESTROY // For development - change for production
    });

    // Create StatusTable with composite key
    const statusTable = new dynamodb.Table(this, 'StatusTable', {
      tableName: 'StatusTable',
      partitionKey: { name: 'Id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'ImageName', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY // For development - change for production
    });

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
