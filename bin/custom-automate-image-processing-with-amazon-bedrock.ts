#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CustomAutomateImageProcessingWithAmazonBedrockStack } from '../lib/custom-automate-image-processing-with-amazon-bedrock-stack';
import { applyCdkNag } from '../lib/utils/security';

const app = new cdk.App();

const stack = new CustomAutomateImageProcessingWithAmazonBedrockStack(app, 'CustomAutomateImageProcessingWithAmazonBedrockStack', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: 'ap-northeast-1' // Tokyo region as specified in requirements
  },
  description: 'CDK application for automating large-scale image background replacement using Amazon Bedrock'
});

// Apply CDK Nag security checks
applyCdkNag(stack);