#!/usr/bin/env node

/**
 * Simple deployment helper that delegates to `cdk deploy` with environment context.
 */

const { spawnSync } = require('child_process');
const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

const environment = process.argv[2] || process.env.DEPLOY_ENV;

if (!environment) {
  console.error('Usage: node scripts/deploy.js <environment>');
  process.exit(1);
}

const configPath = join(__dirname, '..', 'config', 'environments', `${environment}.json`);

if (!existsSync(configPath)) {
  console.error(`Environment configuration not found: ${configPath}`);
  process.exit(1);
}

const deploymentConfig = safeReadJson(configPath, environment);
const profile = process.env.AWS_PROFILE || 'default';

console.log(
  `Deploying environment '${environment}' using profile '${profile}' (${deploymentConfig.account ?? 'CDK_DEFAULT_ACCOUNT'} / ${deploymentConfig.region ?? 'CDK_DEFAULT_REGION'})`
);

const envVars = {
  ...process.env,
  AWS_PROFILE: profile
};

const cdkArgs = ['cdk', 'deploy', '--context', `deployEnvironments=${environment}`, '--require-approval', 'never'];
runCommand('npx', cdkArgs, envVars);

const stackNamePrefix = deploymentConfig.stackNamePrefix || deploymentConfig.stageId || deriveStageId(environment);
const stackNames = buildStackNames(stackNamePrefix);

stackNames.forEach((stackName) => {
  applyStackPolicy(stackName, profile, envVars);
  verifyStackHealth(stackName, profile, envVars);
});

console.log('Deployment completed with stack policies applied and health checks passed.');

function runCommand(command, args, env) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: join(__dirname, '..'),
    env
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function safeReadJson(path, envName) {
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Failed to parse configuration for environment '${envName}':`, error.message ?? error);
    process.exit(1);
  }
}

function deriveStageId(envName) {
  return `ImageProcessing${envName
    .split(/[^a-zA-Z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')}`;
}

function buildStackNames(prefix) {
  const components = ['storage', 'auth', 'notification', 'compute', 'orchestration', 'api', 'monitoring'];
  return components.map((component) => `${prefix}-${component}`);
}

function applyStackPolicy(stackName, profileName, env) {
  const policy = {
    Statement: [
      {
        Effect: 'Deny',
        Action: 'Delete',
        Principal: '*',
        Resource: '*',
        Condition: {
          StringEquals: {
            ResourceType: ['AWS::S3::Bucket', 'AWS::DynamoDB::Table', 'AWS::SNS::Topic']
          }
        }
      }
    ]
  };

  const args = [
    'cloudformation',
    'set-stack-policy',
    '--stack-name',
    stackName,
    '--stack-policy-body',
    JSON.stringify(policy),
    '--profile',
    profileName
  ];

  const result = spawnSync('aws', args, {
    stdio: 'inherit',
    cwd: join(__dirname, '..'),
    env
  });

  if (result.error || result.status !== 0) {
    console.error(`Failed to apply stack policy to ${stackName}.`);
    process.exit(result.status ?? 1);
  }
}

function verifyStackHealth(stackName, profileName, env) {
  const args = [
    'cloudformation',
    'describe-stacks',
    '--stack-name',
    stackName,
    '--query',
    'Stacks[0].StackStatus',
    '--output',
    'text',
    '--profile',
    profileName
  ];

  const result = spawnSync('aws', args, {
    stdio: 'pipe',
    cwd: join(__dirname, '..'),
    env
  });

  if (result.error || result.status !== 0) {
    console.error(`Failed to verify stack health for ${stackName}.`);
    process.exit(result.status ?? 1);
  }

  const status = (result.stdout ?? Buffer.from('')).toString().trim();

  if (!status.endsWith('_COMPLETE') || status.includes('ROLLBACK') || status.includes('FAILED')) {
    console.error(`Stack ${stackName} is not healthy. Current status: ${status}`);
    process.exit(1);
  }

  console.log(`Stack ${stackName} status: ${status}`);
}
