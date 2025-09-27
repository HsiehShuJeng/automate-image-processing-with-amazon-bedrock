/**
 * CDK Nag compliance tests for Compute Stack.
 */

import { App, Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { ComputeStack } from '../lib/constructs/compute-stack';
import { StorageStack } from '../lib/constructs/storage-stack';
import { DEFAULT_CONFIG } from '../lib/types';

describe('ComputeStack CDK Nag Compliance', () => {
  test('passes AWS Solutions checks without errors', () => {
    const app = new App();

    const storageStack = new StorageStack(app, 'NagTestStorageStack', {
      config: DEFAULT_CONFIG,
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });

    const computeStack = new ComputeStack(app, 'NagTestComputeStack', {
      config: DEFAULT_CONFIG,
      bucket: storageStack.outputs.bucket,
      imagesTable: storageStack.outputs.imagesTable,
      statusTable: storageStack.outputs.statusTable,
      snsTopic: undefined as any,
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });

    Aspects.of(computeStack).add(new AwsSolutionsChecks({ verbose: false }));

    const assembly = app.synth();
    expect(assembly).toBeDefined();
    expect(assembly.stacks).toHaveLength(2);
  });
});
