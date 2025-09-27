#!/usr/bin/env node
"use strict";
/**
 * Orchestration Stack for the Image Processing application.
 * Manages the Step Functions workflow that coordinates Bedrock, Lambda, DynamoDB, and SNS.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrchestrationStack = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const stepfunctions = __importStar(require("aws-cdk-lib/aws-stepfunctions"));
const tasks = __importStar(require("aws-cdk-lib/aws-stepfunctions-tasks"));
const utils_1 = require("../utils");
class OrchestrationStack extends aws_cdk_lib_1.Stack {
    outputs;
    constructor(scope, id, props) {
        super(scope, id, props);
        const logGroup = new logs.LogGroup(this, 'ImageProcessingWorkflowLogs', {
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY
        });
        const bedrockModelArn = `arn:aws:bedrock:us-east-1::foundation-model/${props.config.bedrockModelId}`;
        const updateFailedTask = new tasks.DynamoPutItem(this, "Update 'Failed' Status", {
            table: props.statusTable,
            item: {
                Id: tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$.Id')),
                ImageName: tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$.Image.ImageName')),
                Status: tasks.DynamoAttributeValue.fromString('Failed'),
                Error: tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$.Status.Error')),
                Cause: tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$.Status.Cause'))
            }
        });
        const updateSucceededTask = new tasks.DynamoPutItem(this, "Update 'Succeeded' Status", {
            table: props.statusTable,
            item: {
                Id: tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$.Id')),
                ImageName: tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$.Image.ImageName')),
                Status: tasks.DynamoAttributeValue.fromString('Succeeded')
            }
        });
        const buildBedrockRequestTask = new tasks.LambdaInvoke(this, 'Build Bedrock Request', {
            lambdaFunction: props.computeFunctions.buildRequestFunction,
            payload: stepfunctions.TaskInput.fromJsonPathAt('$'),
            resultPath: stepfunctions.JsonPath.DISCARD
        });
        buildBedrockRequestTask.addRetry({
            errors: [
                'Lambda.ServiceException',
                'Lambda.AWSLambdaException',
                'Lambda.SdkClientException',
                'Lambda.TooManyRequestsException'
            ],
            interval: aws_cdk_lib_1.Duration.seconds(1),
            maxAttempts: 3,
            backoffRate: 2
        });
        buildBedrockRequestTask.addCatch(updateFailedTask, {
            resultPath: '$.Status'
        });
        const bedrockInvokeTask = new tasks.CallAwsService(this, 'Bedrock InvokeModel', {
            service: 'bedrock',
            action: 'invokeModel',
            iamAction: 'bedrock:InvokeModel',
            iamResources: [bedrockModelArn],
            parameters: {
                ModelId: bedrockModelArn,
                Input: {
                    S3Uri: stepfunctions.JsonPath.format('s3://{}/{}/{}.json', stepfunctions.JsonPath.stringAt('$.S3Bucket'), stepfunctions.JsonPath.stringAt('$.InputS3Prefix'), stepfunctions.JsonPath.arrayGetItem(stepfunctions.JsonPath.stringSplit(stepfunctions.JsonPath.stringAt('$.Image.ImageName'), '.'), 0))
                },
                Output: {
                    S3Uri: stepfunctions.JsonPath.format('s3://{}/{}/{}.json', stepfunctions.JsonPath.stringAt('$.S3Bucket'), stepfunctions.JsonPath.stringAt('$.OutputS3Prefix'), stepfunctions.JsonPath.arrayGetItem(stepfunctions.JsonPath.stringSplit(stepfunctions.JsonPath.stringAt('$.Image.ImageName'), '.'), 0))
                },
                ContentType: 'application/json'
            },
            resultPath: '$.output'
        });
        bedrockInvokeTask.addCatch(updateFailedTask, {
            resultPath: '$.Status'
        });
        const parseBedrockResponseTask = new tasks.LambdaInvoke(this, 'Parse Bedrock Response', {
            lambdaFunction: props.computeFunctions.parseResponseFunction,
            payload: stepfunctions.TaskInput.fromJsonPathAt('$'),
            resultPath: stepfunctions.JsonPath.DISCARD
        });
        parseBedrockResponseTask.addRetry({
            errors: [
                'Lambda.ServiceException',
                'Lambda.AWSLambdaException',
                'Lambda.SdkClientException',
                'Lambda.TooManyRequestsException'
            ],
            interval: aws_cdk_lib_1.Duration.seconds(1),
            maxAttempts: 3,
            backoffRate: 2
        });
        parseBedrockResponseTask.addCatch(updateFailedTask, {
            resultPath: '$.Status'
        });
        const map = new stepfunctions.DistributedMap(this, 'Process Images', {
            itemsPath: stepfunctions.JsonPath.stringAt('$.Images'),
            itemSelector: {
                Id: stepfunctions.JsonPath.stringAt('$.Id'),
                S3Bucket: stepfunctions.JsonPath.stringAt('$.S3Bucket'),
                InputS3Prefix: stepfunctions.JsonPath.stringAt('$.InputS3Prefix'),
                OutputS3Prefix: stepfunctions.JsonPath.stringAt('$.OutputS3Prefix'),
                Prompt: stepfunctions.JsonPath.stringAt('$.Prompt'),
                NegativePrompt: stepfunctions.JsonPath.stringAt('$.NegativePrompt'),
                Mode: stepfunctions.JsonPath.stringAt('$.Mode'),
                Image: stepfunctions.JsonPath.stringAt('$$.Map.Item.Value')
            },
            maxConcurrency: props.config.maxConcurrency,
            toleratedFailurePercentage: 90,
            resultPath: stepfunctions.JsonPath.DISCARD
        });
        map.itemProcessor(buildBedrockRequestTask
            .next(bedrockInvokeTask)
            .next(parseBedrockResponseTask)
            .next(updateSucceededTask));
        const generateStatusReportTask = new tasks.LambdaInvoke(this, 'Generate Status Report', {
            lambdaFunction: props.computeFunctions.statusReportFunction,
            payload: stepfunctions.TaskInput.fromJsonPathAt('$'),
            resultSelector: {
                ReportURL: stepfunctions.JsonPath.stringAt('$.Payload.ReportURL'),
                ReportS3Key: stepfunctions.JsonPath.stringAt('$.Payload.ReportS3Key')
            },
            resultPath: '$.StatusReport'
        });
        generateStatusReportTask.addRetry({
            errors: [
                'Lambda.ServiceException',
                'Lambda.AWSLambdaException',
                'Lambda.SdkClientException',
                'Lambda.TooManyRequestsException'
            ],
            interval: aws_cdk_lib_1.Duration.seconds(1),
            maxAttempts: 3,
            backoffRate: 2
        });
        const sendEmailTask = new tasks.SnsPublish(this, 'Send Email', {
            topic: props.snsTopic,
            message: stepfunctions.TaskInput.fromText(stepfunctions.JsonPath.format('Hi,\n\nWe are pleased to inform you that the image processing has been successfully completed.\n\nYou can access the status report at the following link: \ns3://{}/{}/\n\nAll processed images can be found in the S3 bucket at the following location:\n\ns3://{}/{}/\n\nThank you.\n\nBest regards,\n\nIT Team', stepfunctions.JsonPath.stringAt('$.S3Bucket'), stepfunctions.JsonPath.stringAt('$.StatusS3Prefix'), stepfunctions.JsonPath.stringAt('$.S3Bucket'), stepfunctions.JsonPath.stringAt('$.OutputS3Prefix'))),
            subject: 'Image Processing Completed - Status Report Available',
            resultPath: stepfunctions.JsonPath.DISCARD
        });
        map.next(generateStatusReportTask);
        generateStatusReportTask.next(sendEmailTask);
        const definition = map;
        const stateMachine = new stepfunctions.StateMachine(this, 'ImageProcessingWorkflow', {
            stateMachineName: props.config.imageProcessingWorkflowName,
            definitionBody: stepfunctions.DefinitionBody.fromChainable(definition),
            tracingEnabled: true,
            logs: {
                destination: logGroup,
                level: stepfunctions.LogLevel.ALL,
                includeExecutionData: true
            },
            timeout: aws_cdk_lib_1.Duration.minutes(15)
        });
        stateMachine.addToRolePolicy(new iam.PolicyStatement({
            actions: ['bedrock:InvokeModel'],
            resources: [bedrockModelArn]
        }));
        stateMachine.addToRolePolicy(new iam.PolicyStatement({
            actions: ['lambda:InvokeFunction'],
            resources: [
                props.computeFunctions.buildRequestFunction.functionArn,
                `${props.computeFunctions.buildRequestFunction.functionArn}:*`,
                props.computeFunctions.parseResponseFunction.functionArn,
                `${props.computeFunctions.parseResponseFunction.functionArn}:*`,
                props.computeFunctions.statusReportFunction.functionArn,
                `${props.computeFunctions.statusReportFunction.functionArn}:*`
            ]
        }));
        stateMachine.addToRolePolicy(new iam.PolicyStatement({
            actions: ['dynamodb:PutItem'],
            resources: [props.statusTable.tableArn]
        }));
        stateMachine.addToRolePolicy(new iam.PolicyStatement({
            actions: ['sns:Publish'],
            resources: [props.snsTopic.topicArn]
        }));
        stateMachine.addToRolePolicy(new iam.PolicyStatement({
            actions: ['s3:GetObject', 's3:PutObject', 's3:AbortMultipartUpload', 's3:ListMultipartUploadParts'],
            resources: [props.bucket.arnForObjects('*')]
        }));
        stateMachine.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                'xray:PutTraceSegments',
                'xray:PutTelemetryRecords',
                'xray:GetSamplingRules',
                'xray:GetSamplingTargets'
            ],
            resources: ['*']
        }));
        props.computeFunctions.startWorkflowFunction.addEnvironment('STATE_MACHINE_IMAGE_PROCESSING_ARN', stateMachine.stateMachineArn);
        stateMachine.grantStartExecution(props.computeFunctions.startWorkflowFunction);
        (0, utils_1.applyCdkNag)(this);
        utils_1.SecuritySuppressions.applyCommonSuppressions(this, 'Orchestration Stack');
        utils_1.SecuritySuppressions.applyStepFunctionsSuppressions(this);
        this.outputs = {
            stateMachine
        };
    }
}
exports.OrchestrationStack = OrchestrationStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3JjaGVzdHJhdGlvbi1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm9yY2hlc3RyYXRpb24tc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFFQTs7O0dBR0c7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBRUgsNkNBQTZEO0FBQzdELHlEQUEyQztBQUMzQywyREFBNkM7QUFDN0MsNkVBQStEO0FBQy9ELDJFQUE2RDtBQUc3RCxvQ0FBNkQ7QUFFN0QsTUFBYSxrQkFBbUIsU0FBUSxtQkFBSztJQUMzQixPQUFPLENBQTRCO0lBRW5ELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBOEI7UUFDdEUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxRQUFRLEdBQUcsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSw2QkFBNkIsRUFBRTtZQUN0RSxTQUFTLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxTQUFTO1lBQ3ZDLGFBQWEsRUFBRSwyQkFBYSxDQUFDLE9BQU87U0FDckMsQ0FBQyxDQUFDO1FBRUgsTUFBTSxlQUFlLEdBQUcsK0NBQStDLEtBQUssQ0FBQyxNQUFNLENBQUMsY0FBYyxFQUFFLENBQUM7UUFFckcsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLEtBQUssQ0FBQyxhQUFhLENBQUMsSUFBSSxFQUFFLHdCQUF3QixFQUFFO1lBQy9FLEtBQUssRUFBRSxLQUFLLENBQUMsV0FBVztZQUN4QixJQUFJLEVBQUU7Z0JBQ0osRUFBRSxFQUFFLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxVQUFVLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUM7Z0JBQ2xGLFNBQVMsRUFBRSxLQUFLLENBQUMsb0JBQW9CLENBQUMsVUFBVSxDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLG1CQUFtQixDQUFDLENBQUM7Z0JB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RUFDcEMsWUFBWSxDQUFDLGVBQWUsQ0FDN0IsQ0FBQztRQUNGLFlBQVksQ0FBQyxtQkFBbUIsQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLENBQUMscUJBQXFCLENBQUMsQ0FBQztRQUUvRSxJQUFBLG1CQUFXLEVBQUMsSUFBSSxDQUFDLENBQUM7UUFDbEIsNEJBQW9CLENBQUMsdUJBQXVCLENBQUMsSUFBSSxFQUFFLHFCQUFxQixDQUFDLENBQUM7UUFDMUUsNEJBQW9CLENBQUMsOEJBQThCLENBQUMsSUFBSSxDQUFDLENBQUM7UUFFMUQsSUFBSSxDQUFDLE9BQU8sR0FBRztZQUNiLFlBQVk7U0FDYixDQUFDO0lBQ0osQ0FBQztDQUNGO0FBblBELGdEQW1QQyIsInNvdXJjZXNDb250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5vZGVcblxuLyoqXG4gKiBPcmNoZXN0cmF0aW9uIFN0YWNrIGZvciB0aGUgSW1hZ2UgUHJvY2Vzc2luZyBhcHBsaWNhdGlvbi5cbiAqIE1hbmFnZXMgdGhlIFN0ZXAgRnVuY3Rpb25zIHdvcmtmbG93IHRoYXQgY29vcmRpbmF0ZXMgQmVkcm9jaywgTGFtYmRhLCBEeW5hbW9EQiwgYW5kIFNOUy5cbiAqL1xuXG5pbXBvcnQgeyBEdXJhdGlvbiwgUmVtb3ZhbFBvbGljeSwgU3RhY2sgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCAqIGFzIHN0ZXBmdW5jdGlvbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXN0ZXBmdW5jdGlvbnMnO1xuaW1wb3J0ICogYXMgdGFza3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLXN0ZXBmdW5jdGlvbnMtdGFza3MnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBPcmNoZXN0cmF0aW9uU3RhY2tPdXRwdXRzLCBPcmNoZXN0cmF0aW9uU3RhY2tQcm9wcyB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IGFwcGx5Q2RrTmFnLCBTZWN1cml0eVN1cHByZXNzaW9ucyB9IGZyb20gJy4uL3V0aWxzJztcblxuZXhwb3J0IGNsYXNzIE9yY2hlc3RyYXRpb25TdGFjayBleHRlbmRzIFN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IG91dHB1dHM6IE9yY2hlc3RyYXRpb25TdGFja091dHB1dHM7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IE9yY2hlc3RyYXRpb25TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCBsb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsICdJbWFnZVByb2Nlc3NpbmdXb3JrZmxvd0xvZ3MnLCB7XG4gICAgICByZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1lcbiAgICB9KTtcblxuICAgIGNvbnN0IGJlZHJvY2tNb2RlbEFybiA9IGBhcm46YXdzOmJlZHJvY2s6dXMtZWFzdC0xOjpmb3VuZGF0aW9uLW1vZGVsLyR7cHJvcHMuY29uZmlnLmJlZHJvY2tNb2RlbElkfWA7XG5cbiAgICBjb25zdCB1cGRhdGVGYWlsZWRUYXNrID0gbmV3IHRhc2tzLkR5bmFtb1B1dEl0ZW0odGhpcywgXCJVcGRhdGUgJ0ZhaWxlZCcgU3RhdHVzXCIsIHtcbiAgICAgIHRhYmxlOiBwcm9wcy5zdGF0dXNUYWJsZSxcbiAgICAgIGl0ZW06IHtcbiAgICAgICAgSWQ6IHRhc2tzLkR5bmFtb0F0dHJpYnV0ZVZhbHVlLmZyb21TdHJpbmcoc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5JZCcpKSxcbiAgICAgICAgSW1hZ2VOYW1lOiB0YXNrcy5EeW5hbW9BdHRyaWJ1dGVWYWx1ZS5mcm9tU3RyaW5nKHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQuSW1hZ2UuSW1hZ2VOYW1lJykpLFxuICAgICAgICBTdGF0dXM6IHRhc2tzLkR5bmFtb0F0dHJpYnV0ZVZhbHVlLmZyb21TdHJpbmcoJ0ZhaWxlZCcpLFxuICAgICAgICBFcnJvcjogdGFza3MuRHluYW1vQXR0cmlidXRlVmFsdWUuZnJvbVN0cmluZyhzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLlN0YXR1cy5FcnJvcicpKSxcbiAgICAgICAgQ2F1c2U6IHRhc2tzLkR5bmFtb0F0dHJpYnV0ZVZhbHVlLmZyb21TdHJpbmcoc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5TdGF0dXMuQ2F1c2UnKSlcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IHVwZGF0ZVN1Y2NlZWRlZFRhc2sgPSBuZXcgdGFza3MuRHluYW1vUHV0SXRlbSh0aGlzLCBcIlVwZGF0ZSAnU3VjY2VlZGVkJyBTdGF0dXNcIiwge1xuICAgICAgdGFibGU6IHByb3BzLnN0YXR1c1RhYmxlLFxuICAgICAgaXRlbToge1xuICAgICAgICBJZDogdGFza3MuRHluYW1vQXR0cmlidXRlVmFsdWUuZnJvbVN0cmluZyhzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLklkJykpLFxuICAgICAgICBJbWFnZU5hbWU6IHRhc2tzLkR5bmFtb0F0dHJpYnV0ZVZhbHVlLmZyb21TdHJpbmcoc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5JbWFnZS5JbWFnZU5hbWUnKSksXG4gICAgICAgIFN0YXR1czogdGFza3MuRHluYW1vQXR0cmlidXRlVmFsdWUuZnJvbVN0cmluZygnU3VjY2VlZGVkJylcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbnN0IGJ1aWxkQmVkcm9ja1JlcXVlc3RUYXNrID0gbmV3IHRhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnQnVpbGQgQmVkcm9jayBSZXF1ZXN0Jywge1xuICAgICAgbGFtYmRhRnVuY3Rpb246IHByb3BzLmNvbXB1dGVGdW5jdGlvbnMuYnVpbGRSZXF1ZXN0RnVuY3Rpb24sXG4gICAgICBwYXlsb2FkOiBzdGVwZnVuY3Rpb25zLlRhc2tJbnB1dC5mcm9tSnNvblBhdGhBdCgnJCcpLFxuICAgICAgcmVzdWx0UGF0aDogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5ESVNDQVJEXG4gICAgfSk7XG4gICAgYnVpbGRCZWRyb2NrUmVxdWVzdFRhc2suYWRkUmV0cnkoe1xuICAgICAgZXJyb3JzOiBbXG4gICAgICAgICdMYW1iZGEuU2VydmljZUV4Y2VwdGlvbicsXG4gICAgICAgICdMYW1iZGEuQVdTTGFtYmRhRXhjZXB0aW9uJyxcbiAgICAgICAgJ0xhbWJkYS5TZGtDbGllbnRFeGNlcHRpb24nLFxuICAgICAgICAnTGFtYmRhLlRvb01hbnlSZXF1ZXN0c0V4Y2VwdGlvbidcbiAgICAgIF0sXG4gICAgICBpbnRlcnZhbDogRHVyYXRpb24uc2Vjb25kcygxKSxcbiAgICAgIG1heEF0dGVtcHRzOiAzLFxuICAgICAgYmFja29mZlJhdGU6IDJcbiAgICB9KTtcbiAgICBidWlsZEJlZHJvY2tSZXF1ZXN0VGFzay5hZGRDYXRjaCh1cGRhdGVGYWlsZWRUYXNrLCB7XG4gICAgICByZXN1bHRQYXRoOiAnJC5TdGF0dXMnXG4gICAgfSk7XG5cbiAgICBjb25zdCBiZWRyb2NrSW52b2tlVGFzayA9IG5ldyB0YXNrcy5DYWxsQXdzU2VydmljZSh0aGlzLCAnQmVkcm9jayBJbnZva2VNb2RlbCcsIHtcbiAgICAgIHNlcnZpY2U6ICdiZWRyb2NrJyxcbiAgICAgIGFjdGlvbjogJ2ludm9rZU1vZGVsJyxcbiAgICAgIGlhbUFjdGlvbjogJ2JlZHJvY2s6SW52b2tlTW9kZWwnLFxuICAgICAgaWFtUmVzb3VyY2VzOiBbYmVkcm9ja01vZGVsQXJuXSxcbiAgICAgIHBhcmFtZXRlcnM6IHtcbiAgICAgICAgTW9kZWxJZDogYmVkcm9ja01vZGVsQXJuLFxuICAgICAgICBJbnB1dDoge1xuICAgICAgICAgIFMzVXJpOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLmZvcm1hdChcbiAgICAgICAgICAgICdzMzovL3t9L3t9L3t9Lmpzb24nLFxuICAgICAgICAgICAgc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5TM0J1Y2tldCcpLFxuICAgICAgICAgICAgc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5JbnB1dFMzUHJlZml4JyksXG4gICAgICAgICAgICBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLmFycmF5R2V0SXRlbShcbiAgICAgICAgICAgICAgc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdTcGxpdChzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLkltYWdlLkltYWdlTmFtZScpLCAnLicpLFxuICAgICAgICAgICAgICAwXG4gICAgICAgICAgICApXG4gICAgICAgICAgKVxuICAgICAgICB9LFxuICAgICAgICBPdXRwdXQ6IHtcbiAgICAgICAgICBTM1VyaTogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5mb3JtYXQoXG4gICAgICAgICAgICAnczM6Ly97fS97fS97fS5qc29uJyxcbiAgICAgICAgICAgIHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQuUzNCdWNrZXQnKSxcbiAgICAgICAgICAgIHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQuT3V0cHV0UzNQcmVmaXgnKSxcbiAgICAgICAgICAgIHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguYXJyYXlHZXRJdGVtKFxuICAgICAgICAgICAgICBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ1NwbGl0KHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQuSW1hZ2UuSW1hZ2VOYW1lJyksICcuJyksXG4gICAgICAgICAgICAgIDBcbiAgICAgICAgICAgIClcbiAgICAgICAgICApXG4gICAgICAgIH0sXG4gICAgICAgIENvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgIH0sXG4gICAgICByZXN1bHRQYXRoOiAnJC5vdXRwdXQnXG4gICAgfSk7XG4gICAgYmVkcm9ja0ludm9rZVRhc2suYWRkQ2F0Y2godXBkYXRlRmFpbGVkVGFzaywge1xuICAgICAgcmVzdWx0UGF0aDogJyQuU3RhdHVzJ1xuICAgIH0pO1xuXG4gICAgY29uc3QgcGFyc2VCZWRyb2NrUmVzcG9uc2VUYXNrID0gbmV3IHRhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnUGFyc2UgQmVkcm9jayBSZXNwb25zZScsIHtcbiAgICAgIGxhbWJkYUZ1bmN0aW9uOiBwcm9wcy5jb21wdXRlRnVuY3Rpb25zLnBhcnNlUmVzcG9uc2VGdW5jdGlvbixcbiAgICAgIHBheWxvYWQ6IHN0ZXBmdW5jdGlvbnMuVGFza0lucHV0LmZyb21Kc29uUGF0aEF0KCckJyksXG4gICAgICByZXN1bHRQYXRoOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLkRJU0NBUkRcbiAgICB9KTtcbiAgICBwYXJzZUJlZHJvY2tSZXNwb25zZVRhc2suYWRkUmV0cnkoe1xuICAgICAgZXJyb3JzOiBbXG4gICAgICAgICdMYW1iZGEuU2VydmljZUV4Y2VwdGlvbicsXG4gICAgICAgICdMYW1iZGEuQVdTTGFtYmRhRXhjZXB0aW9uJyxcbiAgICAgICAgJ0xhbWJkYS5TZGtDbGllbnRFeGNlcHRpb24nLFxuICAgICAgICAnTGFtYmRhLlRvb01hbnlSZXF1ZXN0c0V4Y2VwdGlvbidcbiAgICAgIF0sXG4gICAgICBpbnRlcnZhbDogRHVyYXRpb24uc2Vjb25kcygxKSxcbiAgICAgIG1heEF0dGVtcHRzOiAzLFxuICAgICAgYmFja29mZlJhdGU6IDJcbiAgICB9KTtcbiAgICBwYXJzZUJlZHJvY2tSZXNwb25zZVRhc2suYWRkQ2F0Y2godXBkYXRlRmFpbGVkVGFzaywge1xuICAgICAgcmVzdWx0UGF0aDogJyQuU3RhdHVzJ1xuICAgIH0pO1xuXG4gICAgY29uc3QgbWFwID0gbmV3IHN0ZXBmdW5jdGlvbnMuRGlzdHJpYnV0ZWRNYXAodGhpcywgJ1Byb2Nlc3MgSW1hZ2VzJywge1xuICAgICAgaXRlbXNQYXRoOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLkltYWdlcycpLFxuICAgICAgaXRlbVNlbGVjdG9yOiB7XG4gICAgICAgIElkOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLklkJyksXG4gICAgICAgIFMzQnVja2V0OiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLlMzQnVja2V0JyksXG4gICAgICAgIElucHV0UzNQcmVmaXg6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQuSW5wdXRTM1ByZWZpeCcpLFxuICAgICAgICBPdXRwdXRTM1ByZWZpeDogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5PdXRwdXRTM1ByZWZpeCcpLFxuICAgICAgICBQcm9tcHQ6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQuUHJvbXB0JyksXG4gICAgICAgIE5lZ2F0aXZlUHJvbXB0OiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLk5lZ2F0aXZlUHJvbXB0JyksXG4gICAgICAgIE1vZGU6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQuTW9kZScpLFxuICAgICAgICBJbWFnZTogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJCQuTWFwLkl0ZW0uVmFsdWUnKVxuICAgICAgfSxcbiAgICAgIG1heENvbmN1cnJlbmN5OiBwcm9wcy5jb25maWcubWF4Q29uY3VycmVuY3ksXG4gICAgICB0b2xlcmF0ZWRGYWlsdXJlUGVyY2VudGFnZTogOTAsXG4gICAgICByZXN1bHRQYXRoOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLkRJU0NBUkRcbiAgICB9KTtcblxuICAgIG1hcC5pdGVtUHJvY2Vzc29yKFxuICAgICAgYnVpbGRCZWRyb2NrUmVxdWVzdFRhc2tcbiAgICAgICAgLm5leHQoYmVkcm9ja0ludm9rZVRhc2spXG4gICAgICAgIC5uZXh0KHBhcnNlQmVkcm9ja1Jlc3BvbnNlVGFzaylcbiAgICAgICAgLm5leHQodXBkYXRlU3VjY2VlZGVkVGFzaylcbiAgICApO1xuXG4gICAgY29uc3QgZ2VuZXJhdGVTdGF0dXNSZXBvcnRUYXNrID0gbmV3IHRhc2tzLkxhbWJkYUludm9rZSh0aGlzLCAnR2VuZXJhdGUgU3RhdHVzIFJlcG9ydCcsIHtcbiAgICAgIGxhbWJkYUZ1bmN0aW9uOiBwcm9wcy5jb21wdXRlRnVuY3Rpb25zLnN0YXR1c1JlcG9ydEZ1bmN0aW9uLFxuICAgICAgcGF5bG9hZDogc3RlcGZ1bmN0aW9ucy5UYXNrSW5wdXQuZnJvbUpzb25QYXRoQXQoJyQnKSxcbiAgICAgIHJlc3VsdFNlbGVjdG9yOiB7XG4gICAgICAgIFJlcG9ydFVSTDogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5QYXlsb2FkLlJlcG9ydFVSTCcpLFxuICAgICAgICBSZXBvcnRTM0tleTogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5QYXlsb2FkLlJlcG9ydFMzS2V5JylcbiAgICAgIH0sXG4gICAgICByZXN1bHRQYXRoOiAnJC5TdGF0dXNSZXBvcnQnXG4gICAgfSk7XG4gICAgZ2VuZXJhdGVTdGF0dXNSZXBvcnRUYXNrLmFkZFJldHJ5KHtcbiAgICAgIGVycm9yczogW1xuICAgICAgICAnTGFtYmRhLlNlcnZpY2VFeGNlcHRpb24nLFxuICAgICAgICAnTGFtYmRhLkFXU0xhbWJkYUV4Y2VwdGlvbicsXG4gICAgICAgICdMYW1iZGEuU2RrQ2xpZW50RXhjZXB0aW9uJyxcbiAgICAgICAgJ0xhbWJkYS5Ub29NYW55UmVxdWVzdHNFeGNlcHRpb24nXG4gICAgICBdLFxuICAgICAgaW50ZXJ2YWw6IER1cmF0aW9uLnNlY29uZHMoMSksXG4gICAgICBtYXhBdHRlbXB0czogMyxcbiAgICAgIGJhY2tvZmZSYXRlOiAyXG4gICAgfSk7XG5cbiAgICBjb25zdCBzZW5kRW1haWxUYXNrID0gbmV3IHRhc2tzLlNuc1B1Ymxpc2godGhpcywgJ1NlbmQgRW1haWwnLCB7XG4gICAgICB0b3BpYzogcHJvcHMuc25zVG9waWMsXG4gICAgICBtZXNzYWdlOiBzdGVwZnVuY3Rpb25zLlRhc2tJbnB1dC5mcm9tVGV4dChcbiAgICAgICAgc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5mb3JtYXQoXG4gICAgICAgICAgJ0hpLFxcblxcbldlIGFyZSBwbGVhc2VkIHRvIGluZm9ybSB5b3UgdGhhdCB0aGUgaW1hZ2UgcHJvY2Vzc2luZyBoYXMgYmVlbiBzdWNjZXNzZnVsbHkgY29tcGxldGVkLlxcblxcbllvdSBjYW4gYWNjZXNzIHRoZSBzdGF0dXMgcmVwb3J0IGF0IHRoZSBmb2xsb3dpbmcgbGluazogXFxuczM6Ly97fS97fS9cXG5cXG5BbGwgcHJvY2Vzc2VkIGltYWdlcyBjYW4gYmUgZm91bmQgaW4gdGhlIFMzIGJ1Y2tldCBhdCB0aGUgZm9sbG93aW5nIGxvY2F0aW9uOlxcblxcbnMzOi8ve30ve30vXFxuXFxuVGhhbmsgeW91LlxcblxcbkJlc3QgcmVnYXJkcyxcXG5cXG5JVCBUZWFtJyxcbiAgICAgICAgICBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLlMzQnVja2V0JyksXG4gICAgICAgICAgc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5TdGF0dXNTM1ByZWZpeCcpLFxuICAgICAgICAgIHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQuUzNCdWNrZXQnKSxcbiAgICAgICAgICBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLk91dHB1dFMzUHJlZml4JylcbiAgICAgICAgKVxuICAgICAgKSxcbiAgICAgIHN1YmplY3Q6ICdJbWFnZSBQcm9jZXNzaW5nIENvbXBsZXRlZCAtIFN0YXR1cyBSZXBvcnQgQXZhaWxhYmxlJyxcbiAgICAgIHJlc3VsdFBhdGg6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguRElTQ0FSRFxuICAgIH0pO1xuXG4gICAgbWFwLm5leHQoZ2VuZXJhdGVTdGF0dXNSZXBvcnRUYXNrKTtcbiAgICBnZW5lcmF0ZVN0YXR1c1JlcG9ydFRhc2submV4dChzZW5kRW1haWxUYXNrKTtcblxuICAgIGNvbnN0IGRlZmluaXRpb24gPSBtYXA7XG5cbiAgICBjb25zdCBzdGF0ZU1hY2hpbmUgPSBuZXcgc3RlcGZ1bmN0aW9ucy5TdGF0ZU1hY2hpbmUodGhpcywgJ0ltYWdlUHJvY2Vzc2luZ1dvcmtmbG93Jywge1xuICAgICAgc3RhdGVNYWNoaW5lTmFtZTogcHJvcHMuY29uZmlnLmltYWdlUHJvY2Vzc2luZ1dvcmtmbG93TmFtZSxcbiAgICAgIGRlZmluaXRpb25Cb2R5OiBzdGVwZnVuY3Rpb25zLkRlZmluaXRpb25Cb2R5LmZyb21DaGFpbmFibGUoZGVmaW5pdGlvbiksXG4gICAgICB0cmFjaW5nRW5hYmxlZDogdHJ1ZSxcbiAgICAgIGxvZ3M6IHtcbiAgICAgICAgZGVzdGluYXRpb246IGxvZ0dyb3VwLFxuICAgICAgICBsZXZlbDogc3RlcGZ1bmN0aW9ucy5Mb2dMZXZlbC5BTEwsXG4gICAgICAgIGluY2x1ZGVFeGVjdXRpb25EYXRhOiB0cnVlXG4gICAgICB9LFxuICAgICAgdGltZW91dDogRHVyYXRpb24ubWludXRlcygxNSlcbiAgICB9KTtcblxuICAgIHN0YXRlTWFjaGluZS5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydiZWRyb2NrOkludm9rZU1vZGVsJ10sXG4gICAgICByZXNvdXJjZXM6IFtiZWRyb2NrTW9kZWxBcm5dXG4gICAgfSkpO1xuXG4gICAgc3RhdGVNYWNoaW5lLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ2xhbWJkYTpJbnZva2VGdW5jdGlvbiddLFxuICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgIHByb3BzLmNvbXB1dGVGdW5jdGlvbnMuYnVpbGRSZXF1ZXN0RnVuY3Rpb24uZnVuY3Rpb25Bcm4sXG4gICAgICAgIGAke3Byb3BzLmNvbXB1dGVGdW5jdGlvbnMuYnVpbGRSZXF1ZXN0RnVuY3Rpb24uZnVuY3Rpb25Bcm59OipgLFxuICAgICAgICBwcm9wcy5jb21wdXRlRnVuY3Rpb25zLnBhcnNlUmVzcG9uc2VGdW5jdGlvbi5mdW5jdGlvbkFybixcbiAgICAgICAgYCR7cHJvcHMuY29tcHV0ZUZ1bmN0aW9ucy5wYXJzZVJlc3BvbnNlRnVuY3Rpb24uZnVuY3Rpb25Bcm59OipgLFxuICAgICAgICBwcm9wcy5jb21wdXRlRnVuY3Rpb25zLnN0YXR1c1JlcG9ydEZ1bmN0aW9uLmZ1bmN0aW9uQXJuLFxuICAgICAgICBgJHtwcm9wcy5jb21wdXRlRnVuY3Rpb25zLnN0YXR1c1JlcG9ydEZ1bmN0aW9uLmZ1bmN0aW9uQXJufToqYFxuICAgICAgXVxuICAgIH0pKTtcblxuICAgIHN0YXRlTWFjaGluZS5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydkeW5hbW9kYjpQdXRJdGVtJ10sXG4gICAgICByZXNvdXJjZXM6IFtwcm9wcy5zdGF0dXNUYWJsZS50YWJsZUFybl1cbiAgICB9KSk7XG5cbiAgICBzdGF0ZU1hY2hpbmUuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnc25zOlB1Ymxpc2gnXSxcbiAgICAgIHJlc291cmNlczogW3Byb3BzLnNuc1RvcGljLnRvcGljQXJuXVxuICAgIH0pKTtcblxuICAgIHN0YXRlTWFjaGluZS5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydzMzpHZXRPYmplY3QnLCAnczM6UHV0T2JqZWN0JywgJ3MzOkFib3J0TXVsdGlwYXJ0VXBsb2FkJywgJ3MzOkxpc3RNdWx0aXBhcnRVcGxvYWRQYXJ0cyddLFxuICAgICAgcmVzb3VyY2VzOiBbcHJvcHMuYnVja2V0LmFybkZvck9iamVjdHMoJyonKV1cbiAgICB9KSk7XG5cbiAgICBzdGF0ZU1hY2hpbmUuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ3hyYXk6UHV0VHJhY2VTZWdtZW50cycsXG4gICAgICAgICd4cmF5OlB1dFRlbGVtZXRyeVJlY29yZHMnLFxuICAgICAgICAneHJheTpHZXRTYW1wbGluZ1J1bGVzJyxcbiAgICAgICAgJ3hyYXk6R2V0U2FtcGxpbmdUYXJnZXRzJ1xuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogWycqJ11cbiAgICB9KSk7XG5cbiAgICBwcm9wcy5jb21wdXRlRnVuY3Rpb25zLnN0YXJ0V29ya2Zsb3dGdW5jdGlvbi5hZGRFbnZpcm9ubWVudChcbiAgICAgICdTVEFURV9NQUNISU5FX0lNQUdFX1BST0NFU1NJTkdfQVJOJyxcbiAgICAgIHN0YXRlTWFjaGluZS5zdGF0ZU1hY2hpbmVBcm5cbiAgICApO1xuICAgIHN0YXRlTWFjaGluZS5ncmFudFN0YXJ0RXhlY3V0aW9uKHByb3BzLmNvbXB1dGVGdW5jdGlvbnMuc3RhcnRXb3JrZmxvd0Z1bmN0aW9uKTtcblxuICAgIGFwcGx5Q2RrTmFnKHRoaXMpO1xuICAgIFNlY3VyaXR5U3VwcHJlc3Npb25zLmFwcGx5Q29tbW9uU3VwcHJlc3Npb25zKHRoaXMsICdPcmNoZXN0cmF0aW9uIFN0YWNrJyk7XG4gICAgU2VjdXJpdHlTdXBwcmVzc2lvbnMuYXBwbHlTdGVwRnVuY3Rpb25zU3VwcHJlc3Npb25zKHRoaXMpO1xuXG4gICAgdGhpcy5vdXRwdXRzID0ge1xuICAgICAgc3RhdGVNYWNoaW5lXG4gICAgfTtcbiAgfVxufVxuIl19