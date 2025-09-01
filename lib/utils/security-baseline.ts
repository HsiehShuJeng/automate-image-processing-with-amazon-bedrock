#!/usr/bin/env node

/**
 * Security baseline configuration for the Image Processing application.
 * Defines security standards and compliance requirements.
 */

/**
 * Security baseline configuration interface.
 */
export interface SecurityBaseline {
  readonly encryption: EncryptionConfig;
  readonly iam: IamConfig;
  readonly logging: LoggingConfig;
  readonly networking: NetworkingConfig;
}

/**
 * Encryption configuration requirements.
 */
export interface EncryptionConfig {
  readonly s3EncryptionEnabled: boolean;
  readonly dynamoDbEncryptionEnabled: boolean;
  readonly snsEncryptionEnabled: boolean;
  readonly lambdaEnvironmentEncryption: boolean;
}

/**
 * IAM configuration requirements.
 */
export interface IamConfig {
  readonly leastPrivilegeAccess: boolean;
  readonly noWildcardPolicies: boolean;
  readonly resourceSpecificPolicies: boolean;
  readonly serviceLinkedRoles: boolean;
}

/**
 * Logging configuration requirements.
 */
export interface LoggingConfig {
  readonly cloudWatchLogsEnabled: boolean;
  readonly xRayTracingEnabled: boolean;
  readonly apiGatewayLogging: boolean;
  readonly stepFunctionsLogging: boolean;
}

/**
 * Networking configuration requirements.
 */
export interface NetworkingConfig {
  readonly vpcEndpointsPreferred: boolean;
  readonly publicAccessBlocked: boolean;
  readonly corsConfigured: boolean;
}

/**
 * Default security baseline for the Image Processing application.
 */
export const DEFAULT_SECURITY_BASELINE: SecurityBaseline = {
  encryption: {
    s3EncryptionEnabled: true,
    dynamoDbEncryptionEnabled: true,
    snsEncryptionEnabled: true,
    lambdaEnvironmentEncryption: true
  },
  iam: {
    leastPrivilegeAccess: true,
    noWildcardPolicies: false, // Some wildcards needed for cross-service integration
    resourceSpecificPolicies: true,
    serviceLinkedRoles: true
  },
  logging: {
    cloudWatchLogsEnabled: true,
    xRayTracingEnabled: true,
    apiGatewayLogging: true,
    stepFunctionsLogging: true
  },
  networking: {
    vpcEndpointsPreferred: false, // Not required for this use case
    publicAccessBlocked: true,
    corsConfigured: true
  }
};

/**
 * Validates that a security configuration meets the baseline requirements.
 * 
 * @param config - Security configuration to validate
 * @param baseline - Security baseline to validate against
 * @returns Array of validation errors, empty if valid
 */
export function validateSecurityBaseline(
  config: Partial<SecurityBaseline>, 
  baseline: SecurityBaseline = DEFAULT_SECURITY_BASELINE
): string[] {
  const errors: string[] = [];

  // Validate encryption requirements
  if (config.encryption) {
    if (baseline.encryption.s3EncryptionEnabled && !config.encryption.s3EncryptionEnabled) {
      errors.push('S3 encryption is required by security baseline');
    }
    if (baseline.encryption.dynamoDbEncryptionEnabled && !config.encryption.dynamoDbEncryptionEnabled) {
      errors.push('DynamoDB encryption is required by security baseline');
    }
  }

  // Validate IAM requirements
  if (config.iam) {
    if (baseline.iam.leastPrivilegeAccess && !config.iam.leastPrivilegeAccess) {
      errors.push('Least privilege access is required by security baseline');
    }
  }

  // Validate logging requirements
  if (config.logging) {
    if (baseline.logging.cloudWatchLogsEnabled && !config.logging.cloudWatchLogsEnabled) {
      errors.push('CloudWatch logging is required by security baseline');
    }
  }

  return errors;
}
