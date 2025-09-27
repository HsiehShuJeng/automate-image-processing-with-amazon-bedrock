import { App } from 'aws-cdk-lib';
import { createStageId, loadDeploymentTargets } from '../lib/utils/app-config';

const BASE_CONTEXT = {
  imageProcessingApp: {
    defaultEnvironment: 'dev',
    environments: {
      dev: {
        account: '123456789012',
        region: 'ap-northeast-1',
        config: {
          notificationEmail: 'dev-notifications@example.com'
        },
        tags: {
          Team: 'ImageProcessing'
        }
      }
    },
    tags: {
      Project: 'ImageProcessingApp'
    }
  }
};

describe('app-config utilities', () => {
  test('creates stage id with pascal case environment name', () => {
    expect(createStageId('dev')).toBe('ImageProcessingDev');
    expect(createStageId('prod-eu')).toBe('ImageProcessingProdEu');
    expect(createStageId('qa_env')).toBe('ImageProcessingQaEnv');
  });

  test('loads deployment targets from context', () => {
    const app = new App({ context: BASE_CONTEXT });

    const targets = loadDeploymentTargets(app);
    expect(targets).toHaveLength(1);

    const target = targets[0];
    expect(target.name).toBe('dev');
    expect(target.env).toEqual({ account: '123456789012', region: 'ap-northeast-1' });
    expect(target.config.notificationEmail).toBe('dev-notifications@example.com');
    expect(target.tags.Project).toBe('ImageProcessingApp');
    expect(target.tags.Team).toBe('ImageProcessing');
    expect(target.stageId).toBe('ImageProcessingDev');
    expect(target.stackNamePrefix).toBe('ImageProcessingDev');
  });

  test('throws when configuration is invalid', () => {
    const app = new App({
      context: {
        imageProcessingApp: {
          environments: {
            dev: {
              region: 'ap-northeast-1'
            }
          }
        }
      }
    });

    expect(() => loadDeploymentTargets(app)).toThrow(/notificationEmail/);
  });

  test('honors deployEnvironments override', () => {
    const app = new App({
      context: {
        imageProcessingApp: {
          environments: {
            dev: {
              config: {
                notificationEmail: 'dev@example.com'
              }
            },
            staging: {
              config: {
                notificationEmail: 'staging@example.com'
              }
            }
          }
        },
        deployEnvironments: 'staging'
      }
    });

    const targets = loadDeploymentTargets(app);
    expect(targets).toHaveLength(1);
    expect(targets[0].name).toBe('staging');
    expect(targets[0].config.notificationEmail).toBe('staging@example.com');
  });
});
