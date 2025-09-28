#!/usr/bin/env node

/**
 * Notification Stack for the Image Processing application.
 * Provides an encrypted SNS topic with an email subscription.
 */

import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { NotificationStackOutputs, NotificationStackProps } from '../types';
import { applyCdkNag, SecuritySuppressions } from '../utils';

export class NotificationStack extends Stack {
  public readonly outputs: NotificationStackOutputs;

  constructor(scope: Construct, id: string, props: NotificationStackProps) {
    super(scope, id, props);

    const encryptionKey = new kms.Key(this, 'NotificationTopicKey', {
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.DESTROY
    });

    const topic = new sns.Topic(this, 'NotificationTopic', {
      topicName: props.config.snsTopicName,
      masterKey: encryptionKey,
      displayName: 'Image Processing Notifications'
    });

    topic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowAccountPublish',
        effect: iam.Effect.ALLOW,
        principals: [new iam.AccountPrincipal(this.account)],
        actions: ['sns:Publish'],
        resources: [topic.topicArn]
      })
    );

    topic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'DenyInsecureTransport',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['sns:Publish'],
        resources: [topic.topicArn],
        conditions: {
          Bool: {
            'aws:SecureTransport': 'false'
          }
        }
      })
    );

    if (props.config.notificationEmail) {
      topic.addSubscription(
        new subscriptions.EmailSubscription(props.config.notificationEmail, {
          json: true
        })
      );
    }

    applyCdkNag(this);
    SecuritySuppressions.applyCommonSuppressions(this, 'Notification Stack');

    this.outputs = {
      topic
    };
  }
}
