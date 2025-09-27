#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { ImageProcessingStage } from '../lib/image-processing-stack';
import { loadDeploymentTargets } from '../lib/utils/app-config';
import { applyCdkNag } from '../lib/utils';

const app = new App();
const deploymentTargets = loadDeploymentTargets(app);

if (deploymentTargets.length === 0) {
  throw new Error('No deployment targets configured for image processing application');
}

deploymentTargets.forEach((target) => {
  const stage = new ImageProcessingStage(app, target.stageId, {
    config: target.config,
    env: target.env,
    environmentName: target.name,
    stackNamePrefix: target.stackNamePrefix
  });

  Object.entries(target.tags).forEach(([key, value]) => {
    Tags.of(stage).add(key, value);
  });

  [
    stage.storageStack,
    stage.authStack,
    stage.notificationStack,
    stage.computeStack,
    stage.orchestrationStack,
    stage.apiStack
  ].forEach(applyCdkNag);
});
