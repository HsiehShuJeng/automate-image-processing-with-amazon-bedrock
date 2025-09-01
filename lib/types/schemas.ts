#!/usr/bin/env node

/**
 * DynamoDB table schema interfaces for the Image Processing application.
 */

/**
 * Schema for ImagesTable records.
 * Matches the SAM template DynamoDB structure.
 */
export interface ImageRecord {
  readonly Id: string; // Partition key (HASH)
  readonly ImageS3Prefix: string;
  readonly Prompt: string;
  readonly NegativePrompt: string;
  readonly Mode: string;
  readonly Images: ImageInfo[];
}

/**
 * Individual image information within an ImageRecord.
 */
export interface ImageInfo {
  readonly ImageName: string;
  readonly Labels: string;
}

/**
 * Schema for StatusTable records.
 * Uses composite key as defined in SAM template.
 */
export interface StatusRecord {
  readonly Id: string; // Partition key (HASH)
  readonly ImageName: string; // Sort key (RANGE)
  readonly Status: 'Succeeded' | 'Failed';
  readonly Error?: string;
  readonly Cause?: string;
}

/**
 * Step Functions workflow input structure.
 */
export interface WorkflowInput {
  readonly Id: string;
  readonly S3Bucket: string;
  readonly InputS3Prefix: string;
  readonly OutputS3Prefix: string;
  readonly StatusS3Prefix: string;
  readonly Prompt: string;
  readonly NegativePrompt: string;
  readonly Mode: string;
  readonly Images: ImageInfo[];
}
