import { createOrchestrationTestContext } from './utils/orchestration-test-context';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';

describe('OrchestrationStack snapshot', () => {
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

  test('matches synthesized template snapshot', () => {
    const { template } = createOrchestrationTestContext();
    expect(template.toJSON()).toMatchSnapshot();
  });
});
