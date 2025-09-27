import { App, Stack, Tags } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ImageProcessingStage } from '../lib/image-processing-stack';
import { DEFAULT_CONFIG } from '../lib/types';

describe('ImageProcessingStage', () => {
  test('composes all infrastructure stacks', () => {
    const app = new App();
    const stage = new ImageProcessingStage(app, 'TestStage', {
      config: DEFAULT_CONFIG,
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });

    const storage = stage.node.tryFindChild('StorageStack');
    const auth = stage.node.tryFindChild('AuthStack');
    const notification = stage.node.tryFindChild('NotificationStack');
    const compute = stage.node.tryFindChild('ComputeStack');
    const orchestration = stage.node.tryFindChild('OrchestrationStack');
    const api = stage.node.tryFindChild('ApiStack');

    expect(storage).toBeInstanceOf(Stack);
    expect(auth).toBeInstanceOf(Stack);
    expect(notification).toBeInstanceOf(Stack);
    expect(compute).toBeInstanceOf(Stack);
    expect(orchestration).toBeInstanceOf(Stack);
    expect(api).toBeInstanceOf(Stack);
  });

  test('uses cross-stack exports to wire compute and API resources', () => {
    const app = new App();
    const stage = new ImageProcessingStage(app, 'DependencyStage', {
      config: { ...DEFAULT_CONFIG, notificationEmail: 'deps@example.com' },
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });

    const stackPrefix = stage.stackNamePrefix;

    const computeTemplate = Template.fromStack(stage.computeStack);
    computeTemplate.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          INPUT_BUCKET: Match.objectLike({
            'Fn::ImportValue': Match.stringLikeRegexp(`${stackPrefix}-storage:ExportsOutput`)
          })
        })
      }
    });

    computeTemplate.hasResourceProperties('AWS::IAM::Policy', Match.objectLike({
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Resource: Match.arrayWith([
              Match.objectLike({
                'Fn::ImportValue': Match.stringLikeRegexp(`${stackPrefix}-storage:ExportsOutput`)
              })
            ])
          }),
          Match.objectLike({
            Resource: Match.objectLike({
              'Fn::ImportValue': Match.stringLikeRegexp(`${stackPrefix}-notification:ExportsOutput`)
            })
          })
        ])
      })
    }));

    const apiTemplate = Template.fromStack(stage.apiStack);
    apiTemplate.hasResourceProperties('AWS::IAM::Role', Match.objectLike({
      Policies: Match.arrayWith([
        Match.objectLike({
          PolicyDocument: Match.objectLike({
            Statement: Match.arrayWith([
              Match.objectLike({
                Resource: Match.objectLike({
                  'Fn::ImportValue': Match.stringLikeRegexp(`${stackPrefix}-storage:ExportsOutput`)
                })
              })
            ])
          })
        })
      ])
    }));
  });

  test('applies environment-specific stack name prefix', () => {
    const app = new App();
    const config = { ...DEFAULT_CONFIG, notificationEmail: 'ops@example.com' };

    const stage = new ImageProcessingStage(app, 'ProdStage', {
      config,
      environmentName: 'prod-eu',
      stackNamePrefix: 'ImageProcessingProdEu',
      env: { account: '123456789012', region: 'eu-central-1' }
    });

    expect(stage.environmentName).toBe('prod-eu');
    expect(stage.stackNamePrefix).toBe('ImageProcessingProdEu');
    expect(stage.storageStack.stackName).toBe('ImageProcessingProdEu-storage');
    expect(stage.authStack.stackName).toBe('ImageProcessingProdEu-auth');
    expect(stage.apiStack.stackName).toBe('ImageProcessingProdEu-api');
  });

  test('configures start workflow Lambda with derived state machine ARN and permissions', () => {
    const app = new App();
    const stage = new ImageProcessingStage(app, 'IntegrationStage', {
      config: { ...DEFAULT_CONFIG, notificationEmail: 'stage@example.com' },
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });

    const templateJson = Template.fromStack(stage.computeStack).toJSON();
    const resources = Object.values(templateJson.Resources) as any[];

    const startWorkflowFunction = resources.find(
      (res) =>
        res.Type === 'AWS::Lambda::Function' &&
        res.Properties?.Environment?.Variables?.STATE_MACHINE_IMAGE_PROCESSING_ARN
    );

    expect(startWorkflowFunction).toBeDefined();
    expect(startWorkflowFunction?.Properties.Environment.Variables.STATE_MACHINE_IMAGE_PROCESSING_ARN).toEqual({
      'Fn::Join': [
        '',
        [
          'arn:',
          { Ref: 'AWS::Partition' },
          `:states:ap-northeast-1:123456789012:stateMachine/${DEFAULT_CONFIG.imageProcessingWorkflowName}`
        ]
      ]
    });

    const policyStatements = resources
      .filter((res) => res.Type === 'AWS::IAM::Policy')
      .flatMap((res) => res.Properties.PolicyDocument.Statement as any[]);

    const startExecutionStatement = policyStatements.find(
      (statement) => statement.Action === 'states:StartExecution'
    );

    expect(startExecutionStatement).toBeDefined();
    expect(startExecutionStatement?.Resource).toEqual({
      'Fn::Join': [
        '',
        [
          'arn:',
          { Ref: 'AWS::Partition' },
          `:states:ap-northeast-1:123456789012:stateMachine/${DEFAULT_CONFIG.imageProcessingWorkflowName}`
        ]
      ]
    });
  });

  test('synthesizes orchestration definition wiring compute functions and shared resources', () => {
    const app = new App();
    const stage = new ImageProcessingStage(app, 'WorkflowStage', {
      config: { ...DEFAULT_CONFIG, notificationEmail: 'workflow@example.com' },
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });

    const templateJson = Template.fromStack(stage.orchestrationStack).toJSON();
    const stateMachine = Object.values(templateJson.Resources).find(
      (res: any) => res.Type === 'AWS::StepFunctions::StateMachine'
    ) as any;

    expect(stateMachine).toBeDefined();
    expect(stateMachine.Properties.StateMachineName).toBe(DEFAULT_CONFIG.imageProcessingWorkflowName);

    const [, fragments] = stateMachine.Properties.DefinitionString['Fn::Join'];
    const importFragments = (fragments as any[]).filter((fragment) => typeof fragment === 'object');

    expect(importFragments).toEqual(
      expect.arrayContaining([
        { 'Fn::ImportValue': expect.stringContaining('compute:ExportsOutputFnGetAttBuildBedrockRequestFunction') },
        { 'Fn::ImportValue': expect.stringContaining('compute:ExportsOutputFnGetAttParseBedrockResponseFunction') },
        { 'Fn::ImportValue': expect.stringContaining('compute:ExportsOutputFnGetAttGenerateStatusReportFunction') },
        { 'Fn::ImportValue': expect.stringContaining('notification:ExportsOutputRefNotificationTopic') }
      ])
    );
  });

  test('synthesizes complete stage without circular dependencies', () => {
    const app = new App();
    const stage = new ImageProcessingStage(app, 'SynthStage', {
      config: { ...DEFAULT_CONFIG, notificationEmail: 'synth@example.com' },
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });

    expect(() => app.synth()).not.toThrow();
    expect(stage.node.children).toHaveLength(6);
  });

  test('applies stage-level tags to all synthesized resources', () => {
    const app = new App();
    const stage = new ImageProcessingStage(app, 'TaggedStage', {
      config: { ...DEFAULT_CONFIG, notificationEmail: 'tagged@example.com' },
      env: { account: '123456789012', region: 'ap-northeast-1' },
      environmentName: 'test'
    });

    Tags.of(stage).add('Project', 'AutomateImageProcessing');
    Tags.of(stage).add('Environment', 'test');

    const storageTemplate = Template.fromStack(stage.storageStack);
    storageTemplate.hasResourceProperties('AWS::S3::Bucket', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Environment', Value: 'test' })
      ])
    });

    const orchestrationTemplate = Template.fromStack(stage.orchestrationStack);
    orchestrationTemplate.hasResourceProperties('AWS::StepFunctions::StateMachine', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Project', Value: 'AutomateImageProcessing' })
      ])
    });
  });
});
