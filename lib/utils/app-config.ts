#!/usr/bin/env node

/**
 * Utilities for loading deployment configuration from CDK context.
 */

import { App, Environment } from 'aws-cdk-lib';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, parse } from 'path';
import { DEFAULT_CONFIG, ImageProcessingConfig, validateConfig } from '../types';

const CONTEXT_KEY = 'imageProcessingApp';
const DEFAULT_REGION = 'ap-northeast-1';
const ENVIRONMENT_CONFIG_DIRECTORY = join(__dirname, '..', '..', 'config', 'environments');

interface ImageProcessingAppContext {
  readonly defaultEnvironment?: string;
  readonly deployEnvironments?: string[] | string;
  readonly environments?: Record<string, EnvironmentDefinition>;
  readonly tags?: Record<string, string>;
}

interface EnvironmentDefinition {
  readonly account?: string;
  readonly region?: string;
  readonly stageId?: string;
  readonly stackNamePrefix?: string;
  readonly config?: Partial<ImageProcessingConfig>;
  readonly tags?: Record<string, string>;
  readonly terminationProtection?: boolean;
}

export interface DeploymentTarget {
  readonly name: string;
  readonly env: Environment;
  readonly config: ImageProcessingConfig;
  readonly stageId: string;
  readonly stackNamePrefix?: string;
  readonly tags: Record<string, string>;
  readonly terminationProtection: boolean;
}

/**
 * Loads deployment targets for the Image Processing application from CDK context.
 *
 * @param app - The CDK application instance
 * @returns Deployment targets describing each environment to deploy
 */
export function loadDeploymentTargets(app: App): DeploymentTarget[] {
  const appContext = (app.node.tryGetContext(CONTEXT_KEY) ?? {}) as ImageProcessingAppContext;
  const fileDefinitions = loadEnvironmentDefinitionsFromDirectory();
  const environmentDefinitions = {
    ...fileDefinitions,
    ...(appContext.environments ?? {})
  };

  const deploymentOrder = parseEnvironmentOrder(
    app.node.tryGetContext('deployEnvironments') ?? appContext.deployEnvironments,
    appContext.defaultEnvironment,
    Object.keys(environmentDefinitions)
  );

  if (deploymentOrder.length === 0) {
    throw new Error(
      `No deployment environments found. Configure '${CONTEXT_KEY}.environments' in cdk.json or pass --context deployEnvironments=<env>`
    );
  }

  return deploymentOrder.map((environmentName) => {
    const definition = environmentDefinitions[environmentName] ?? {};

    const config = resolveConfig(environmentName, definition.config);
    const env: Environment = {
      account: definition.account ?? process.env.CDK_DEFAULT_ACCOUNT,
      region: definition.region ?? process.env.CDK_DEFAULT_REGION ?? DEFAULT_REGION
    };

    const stageId = definition.stageId ?? createStageId(environmentName);
    const stackNamePrefix = definition.stackNamePrefix ?? stageId;
    const tags = resolveTags(environmentName, appContext.tags, definition.tags);
    const terminationProtection = definition.terminationProtection ?? false;

    return { name: environmentName, env, config, stageId, stackNamePrefix, tags, terminationProtection };
  });
}

/**
 * Creates a stage identifier based on the environment name.
 *
 * @param environmentName - The logical environment name (e.g., dev, prod-eu)
 * @returns Stage identifier suitable for CDK construct IDs
 */
export function createStageId(environmentName: string): string {
  return `ImageProcessing${toPascalCase(environmentName)}`;
}

function resolveConfig(
  environmentName: string,
  overrides: Partial<ImageProcessingConfig> | undefined
): ImageProcessingConfig {
  const config: ImageProcessingConfig = {
    ...DEFAULT_CONFIG,
    ...(overrides ?? {})
  };

  try {
    validateConfig(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid configuration for environment '${environmentName}': ${message}`);
  }

  return config;
}

function resolveTags(
  environmentName: string,
  baseTags: Record<string, string> | undefined,
  environmentTags: Record<string, string> | undefined
): Record<string, string> {
  return {
    Environment: environmentName,
    ...(baseTags ?? {}),
    ...(environmentTags ?? {})
  };
}

function parseEnvironmentOrder(
  deployContext: string[] | string | undefined,
  defaultEnvironment: string | undefined,
  availableEnvironments: string[]
): string[] {
  const normalizeList = (values: (string | number)[]): string[] => {
    const seen = new Set<string>();
    for (const value of values) {
      const normalized = value.toString().trim();
      if (normalized.length > 0) {
        seen.add(normalized);
      }
    }
    return Array.from(seen);
  };

  if (Array.isArray(deployContext) && deployContext.length > 0) {
    return normalizeList(deployContext);
  }

  if (typeof deployContext === 'string' && deployContext.trim().length > 0) {
    return normalizeList(deployContext.split(','));
  }

  if (defaultEnvironment) {
    return [defaultEnvironment];
  }

  if (availableEnvironments.length > 0) {
    return normalizeList(availableEnvironments);
  }

  return [];
}

function toPascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function loadEnvironmentDefinitionsFromDirectory(): Record<string, EnvironmentDefinition> {
  if (!existsSync(ENVIRONMENT_CONFIG_DIRECTORY)) {
    return {};
  }

  const definitions: Record<string, EnvironmentDefinition> = {};
  const files = readdirSync(ENVIRONMENT_CONFIG_DIRECTORY).filter((file) => file.endsWith('.json'));

  for (const file of files) {
    const absolutePath = join(ENVIRONMENT_CONFIG_DIRECTORY, file);
    try {
      const content = readFileSync(absolutePath, 'utf-8');
      const parsed = JSON.parse(content) as EnvironmentDefinition;
      const environmentName = parse(file).name;

      definitions[environmentName] = {
        ...parsed,
        stageId: parsed.stageId ?? createStageId(environmentName)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load environment configuration '${file}': ${message}`);
    }
  }

  return definitions;
}
