import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import { MonitoringStack } from '../lib/constructs/monitoring-stack';
import { ComputeStackOutputs } from '../lib/types';
import { DEFAULT_CONFIG } from '../lib/types';

describe('MonitoringStack', () => {
  beforeEach(() => {
  process.env.CDK_DISABLE_POWERTOOLS_BUNDLING = 'true';
  });

  afterEach(() => {
  delete process.env.CDK_DISABLE_POWERTOOLS_BUNDLING;
  });

  const createComputeOutputs = (scope: Stack): ComputeStackOutputs => {
    const fnProps: lambda.FunctionProps = {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => {};'),
      tracing: lambda.Tracing.DISABLED
    };

    return {
      startWorkflowFunction: new lambda.Function(scope, 'StartWorkflowFn', fnProps),
      buildRequestFunction: new lambda.Function(scope, 'BuildRequestFn', fnProps),
      parseResponseFunction: new lambda.Function(scope, 'ParseResponseFn', fnProps),
      statusReportFunction: new lambda.Function(scope, 'StatusReportFn', fnProps)
    };
  };

  const createMonitoringStack = (app: App, id: string): MonitoringStack => {
    const resourceStack = new Stack(app, `${id}Resources`, {
      env: { account: '123456789012', region: 'ap-northeast-1' }
    });

    const bucket = new s3.Bucket(resourceStack, 'ImageBucket');

    const topic = new sns.Topic(resourceStack, 'NotificationTopic');

    const api = new apigateway.RestApi(resourceStack, 'RestApi', {
      restApiName: `${id}-api`
    });
    api.root.addMethod('GET', new apigateway.MockIntegration({
      integrationResponses: [{ statusCode: '200' }],
      requestTemplates: { 'application/json': '{"statusCode":200}' }
    }), {
      methodResponses: [{ statusCode: '200' }]
    });

    const stateMachine = new stepfunctions.StateMachine(resourceStack, 'StateMachine', {
      definitionBody: stepfunctions.DefinitionBody.fromChainable(new stepfunctions.Pass(resourceStack, 'NoOp'))
    });

    const computeOutputs = createComputeOutputs(resourceStack);

    return new MonitoringStack(app, id, {
      env: { account: '123456789012', region: 'ap-northeast-1' },
      config: { ...DEFAULT_CONFIG, notificationEmail: 'alerts@example.com' },
      computeFunctions: computeOutputs,
      stateMachine,
      api,
      snsTopic: topic,
      bucket
    });
  };

  test('creates dashboard and alarms for critical components', () => {
    const app = new App();
    const monitoringStack = createMonitoringStack(app, 'MonitoringStack');

    const template = Template.fromStack(monitoringStack);
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);

    const alarmCount = Object.keys(template.findResources('AWS::CloudWatch::Alarm')).length;
    expect(alarmCount).toBeGreaterThanOrEqual(5);
  });

  test('configures alarms to notify the shared SNS topic', () => {
    const app = new App();
    const monitoringStack = createMonitoringStack(app, 'AlarmStack');

    const template = Template.fromStack(monitoringStack);
    const alarms = template.findResources('AWS::CloudWatch::Alarm');

    Object.values(alarms).forEach((alarm: any) => {
      const actions = alarm.Properties?.AlarmActions ?? [];
      expect(actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            'Fn::ImportValue': expect.any(String)
          })
        ])
      );
    });
  });
});
