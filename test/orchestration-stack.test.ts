import { Match, Template } from 'aws-cdk-lib/assertions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import { createOrchestrationTestContext } from './utils/orchestration-test-context';

function getDefinitionString(template: Template): string {
  const resources = template.findResources('AWS::StepFunctions::StateMachine');
  const resource = Object.values(resources)[0] as any;
  const definition = resource.Properties?.DefinitionString;

  if (typeof definition === 'string') {
    return definition;
  }

  if (definition && definition['Fn::Join']) {
    const [separator, parts] = definition['Fn::Join'];
    return parts
      .map((part: any) => (typeof part === 'string' ? part : JSON.stringify(part)))
      .join(separator);
  }

  throw new Error('Unexpected DefinitionString format in synthesized template.');
}

describe('OrchestrationStack Definition', () => {
  const envErrors = [
    'Lambda.ServiceException',
    'Lambda.AWSLambdaException',
    'Lambda.SdkClientException',
    'Lambda.TooManyRequestsException'
  ];

  beforeEach(() => {
    jest
      .spyOn(lambda.Function.prototype as any, 'addEnvironment')
      .mockImplementation(function (this: lambda.Function) {
        return this;
      });

    jest
      .spyOn(stepfunctions.StateMachine.prototype, 'grantStartExecution')
      .mockImplementation((grantee: iam.IGrantable) => iam.Grant.drop(grantee, 'test-grant'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('enables CloudWatch logging and X-Ray tracing', () => {
    const { template } = createOrchestrationTestContext();

    template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
      LoggingConfiguration: Match.objectLike({
        Level: 'ALL',
        IncludeExecutionData: true
      }),
      TracingConfiguration: {
        Enabled: true
      }
    });

    template.hasResourceProperties('AWS::Logs::LogGroup', {
      RetentionInDays: 30
    });
  });

  test('configures distributed map with expected failure tolerance', () => {
    const { template, config } = createOrchestrationTestContext();
    const definition = getDefinitionString(template);

    expect(definition).toContain('"Type":"Map"');
    expect(definition).toContain(`"MaxConcurrency":${config.maxConcurrency}`);
    expect(definition).toContain('"Label":"Map"');
    expect(definition).toContain('"ToleratedFailurePercentage":90');
    expect(definition).toContain('"Mode":"DISTRIBUTED"');
    expect(definition).toContain('"ExecutionType":"STANDARD"');
    expect(definition).toContain('"Id.$":"$.Id"');
    expect(definition).toContain('"Image.$":"$$.Map.Item.Value"');
  });

  test('includes retries, catches, and result selectors for critical tasks', () => {
    const { template } = createOrchestrationTestContext();
    const definition = getDefinitionString(template);

    envErrors.forEach(error => {
      expect(definition).toContain(`"${error}"`);
    });
    expect(definition).toContain('"Next":"Update \'Failed\' Status"');
    expect(definition).toContain('states:::aws-sdk:bedrock:invokeModel');
    expect(definition).toContain('"ResultSelector":{"ReportURL.$":"$.Payload.ReportURL","ReportS3Key.$":"$.Payload.ReportS3Key"}');
    expect(definition).toContain('states:::sns:publish');
  });
});
