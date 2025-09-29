#!/usr/bin/env node

/**
 * Configuration interfaces and types for the Image Processing CDK application.
 */

export interface ImageProcessingConfig {
  // API Configuration
  readonly apiName: string;
  
  // Storage Configuration
  readonly bucketName: string;
  readonly imagePrefix: string;
  readonly generatedImagePrefix: string;
  readonly statusReportPrefix: string;
  
  // Bedrock Configuration
  readonly bedrockModelId: string;
  readonly maxConcurrency: number;
  
  // Notification Configuration
  readonly snsTopicName: string;
  readonly notificationEmail: string;
  
  // Status Report Configuration
  readonly statusReportUrlExpiration: number;
  
  // Step Functions Configuration
  readonly imageProcessingWorkflowName: string;
}

/**
 * Default configuration values matching SAM template defaults.
 */
export const DEFAULT_CONFIG: ImageProcessingConfig = {
  apiName: 'api-image',
  bucketName: 'image-processing',
  imagePrefix: 'image-files',
  generatedImagePrefix: 'generated-image-files',
  statusReportPrefix: 'status-report-files',
  bedrockModelId: 'amazon.titan-image-generator-v1',
  maxConcurrency: 10,
  snsTopicName: 'notification-topic',
  notificationEmail: 'fantasticSie@hotmail.com', // Must be provided at deployment
  statusReportUrlExpiration: 86400, // 24 hours in seconds
  imageProcessingWorkflowName: 'image-processing-workflow'
};

/**
 * Validates the configuration parameters.
 * 
 * @param config - Configuration to validate
 * @throws Error if configuration is invalid
 */
export function validateConfig(config: ImageProcessingConfig): void {
  if (!config.notificationEmail || !config.notificationEmail.includes('@')) {
    throw new Error('notificationEmail must be a valid email address');
  }
  
  if (config.maxConcurrency < 1 || config.maxConcurrency > 1000) {
    throw new Error('maxConcurrency must be between 1 and 1000');
  }
  
  if (config.statusReportUrlExpiration < 300 || config.statusReportUrlExpiration > 604800) {
    throw new Error('statusReportUrlExpiration must be between 300 (5 minutes) and 604800 (7 days) seconds');
  }
}
