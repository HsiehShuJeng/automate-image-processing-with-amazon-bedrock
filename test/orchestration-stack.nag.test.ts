import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import { createOrchestrationTestContext } from './utils/orchestration-test-context';

describe('OrchestrationStack CDK Nag Compliance', () => {
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

  test('passes AwsSolutions checks', () => {
    const { app, orchestrationStack } = createOrchestrationTestContext();

    Aspects.of(orchestrationStack).add(new AwsSolutionsChecks({ verbose: false }));

    expect(() => app.synth()).not.toThrow();
  });
});
