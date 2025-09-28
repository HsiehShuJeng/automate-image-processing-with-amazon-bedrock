#!/usr/bin/env node

/**
 * Monitoring Stack that provides dashboards and alarms for the image processing workflow.
 */

import { Duration, Stack } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';
import { MonitoringStackOutputs, MonitoringStackProps } from '../types';
import { applyCdkNag, SecuritySuppressions } from '../utils';

export class MonitoringStack extends Stack {
  public readonly outputs: MonitoringStackOutputs;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const dashboard = new cloudwatch.Dashboard(this, 'ImageProcessingDashboard', {
      dashboardName: `${props.stackName ?? 'ImageProcessing'}-observability`
    });

    const lambdaWidgets: cloudwatch.IWidget[] = [
      new cloudwatch.GraphWidget({
        title: 'Lambda Invocations',
        left: [
          props.computeFunctions.startWorkflowFunction.metricInvocations(),
          props.computeFunctions.buildRequestFunction.metricInvocations(),
          props.computeFunctions.parseResponseFunction.metricInvocations(),
          props.computeFunctions.statusReportFunction.metricInvocations()
        ],
        width: 12,
        height: 6
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors',
        left: [
          props.computeFunctions.startWorkflowFunction.metricErrors(),
          props.computeFunctions.buildRequestFunction.metricErrors(),
          props.computeFunctions.parseResponseFunction.metricErrors(),
          props.computeFunctions.statusReportFunction.metricErrors()
        ],
        width: 12,
        height: 6
      })
    ];

    const workflowWidgets: cloudwatch.IWidget[] = [
      new cloudwatch.GraphWidget({
        title: 'Workflow Executions',
        left: [
          props.stateMachine.metricSucceeded({ period: Duration.minutes(5) }),
          props.stateMachine.metricFailed({ period: Duration.minutes(5) })
        ],
        width: 12,
        height: 6
      }),
      new cloudwatch.GraphWidget({
        title: 'API Gateway 4XX/5XX',
        left: [
          props.api.metricClientError({ period: Duration.minutes(5) }),
          props.api.metricServerError({ period: Duration.minutes(5) })
        ],
        width: 12,
        height: 6
      })
    ];

    const storageWidgets: cloudwatch.IWidget[] = [
      new cloudwatch.GraphWidget({
        title: 'S3 Bucket Size (Bytes)',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/S3',
            metricName: 'BucketSizeBytes',
            statistic: 'Average',
            period: Duration.hours(6),
            dimensionsMap: {
              BucketName: props.bucket.bucketName,
              StorageType: 'StandardStorage'
            }
          })
        ],
        width: 12,
        height: 6
      }),
      new cloudwatch.GraphWidget({
        title: 'S3 Object Count',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/S3',
            metricName: 'NumberOfObjects',
            statistic: 'Average',
            period: Duration.hours(6),
            dimensionsMap: {
              BucketName: props.bucket.bucketName,
              StorageType: 'AllStorageTypes'
            }
          })
        ],
        width: 12,
        height: 6
      })
    ];

    dashboard.addWidgets(...lambdaWidgets);
    dashboard.addWidgets(...workflowWidgets);
    dashboard.addWidgets(...storageWidgets);

    const alarms: cloudwatch.Alarm[] = [];

    const createLambdaErrorAlarm = (id: string, displayName: string, metric: cloudwatch.Metric): cloudwatch.Alarm => {
      const alarm = new cloudwatch.Alarm(this, id, {
        alarmName: `${displayName}-Errors`,
        metric,
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
      });
      alarm.addAlarmAction(new cloudwatchActions.SnsAction(props.snsTopic));
      alarms.push(alarm);
      return alarm;
    };

    createLambdaErrorAlarm(
      'StartWorkflowErrorsAlarm',
      'StartWorkflowFunction',
      props.computeFunctions.startWorkflowFunction.metricErrors({ period: Duration.minutes(5) })
    );

    createLambdaErrorAlarm(
      'BuildRequestErrorsAlarm',
      'BuildBedrockRequestFunction',
      props.computeFunctions.buildRequestFunction.metricErrors({ period: Duration.minutes(5) })
    );

    createLambdaErrorAlarm(
      'ParseResponseErrorsAlarm',
      'ParseBedrockResponseFunction',
      props.computeFunctions.parseResponseFunction.metricErrors({ period: Duration.minutes(5) })
    );

    createLambdaErrorAlarm(
      'StatusReportErrorsAlarm',
      'GenerateStatusReportFunction',
      props.computeFunctions.statusReportFunction.metricErrors({ period: Duration.minutes(5) })
    );

    const workflowFailureAlarm = new cloudwatch.Alarm(this, 'WorkflowFailuresAlarm', {
      alarmName: 'ImageProcessingWorkflow-Failures',
      metric: props.stateMachine.metricFailed({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    workflowFailureAlarm.addAlarmAction(new cloudwatchActions.SnsAction(props.snsTopic));
    alarms.push(workflowFailureAlarm);

    const apiServerErrorAlarm = new cloudwatch.Alarm(this, 'ApiServerErrorsAlarm', {
      alarmName: 'ImageProcessingApi-ServerErrors',
      metric: props.api.metricServerError({ period: Duration.minutes(5) }),
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    apiServerErrorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(props.snsTopic));
    alarms.push(apiServerErrorAlarm);

    applyCdkNag(this);
    SecuritySuppressions.applyCommonSuppressions(this, 'Monitoring Stack');

    this.outputs = {
      dashboard,
      alarms
    };
  }
}
