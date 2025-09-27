#!/usr/bin/env node
/**
 * Orchestration Stack for the Image Processing application.
 * Manages the Step Functions workflow that coordinates Bedrock, Lambda, DynamoDB, and SNS.
 */
import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { OrchestrationStackOutputs, OrchestrationStackProps } from '../types';
export declare class OrchestrationStack extends Stack {
    readonly outputs: OrchestrationStackOutputs;
    constructor(scope: Construct, id: string, props: OrchestrationStackProps);
}
