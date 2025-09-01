#!/usr/bin/env node

/**
 * Authentication Stack for the Image Processing application.
 * Contains Cognito User Pool and User Pool Client.
 */

import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { AuthStackProps, AuthStackOutputs } from '../types';
import { applyCdkNag, SecuritySuppressions } from '../utils';

export class AuthStack extends Stack {
  public readonly outputs: AuthStackOutputs;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    // Create Cognito User Pool with password policies
    const userPool = new cognito.UserPool(this, 'UserPool', {
      autoVerify: { email: true },
      signInAliases: { email: true },
      selfSignUpEnabled: false, // AdminCreateUserOnly as per SAM template
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: true,
        requireUppercase: true
      },
      removalPolicy: RemovalPolicy.DESTROY // For development - change for production
    });

    // Create User Pool Client with secret generation
    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool,
      generateSecret: true,
      authFlows: {
        userPassword: true,
        userSrp: true
      }
    });

    // Apply CDK Nag security checks
    applyCdkNag(this);
    SecuritySuppressions.applyCommonSuppressions(this, 'Auth Stack');

    // Export outputs (authorizer will be created in API stack)
    this.outputs = {
      userPool,
      userPoolClient,
      authorizer: undefined as any // Will be created in API stack
    };
  }
}
