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
                Image: stepfunctions.JsonPath.objectAt('$$.Map.Item.Value')
            },
            maxConcurrency: props.config.maxConcurrency,
            label: 'Map',
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3JjaGVzdHJhdGlvbi1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm9yY2hlc3RyYXRpb24tc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFFQTs7O0dBR0c7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBRUgsNkNBQTZEO0FBQzdELHlEQUEyQztBQUMzQywyREFBNkM7QUFDN0MsNkVBQStEO0FBQy9ELDJFQUE2RDtBQUc3RCxvQ0FBNkQ7QUFFN0QsTUFBYSxrQkFBbUIsU0FBUSxtQkFBSztJQUMzQixPQUFPLENBQTRCO0lBRW5ELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBOEI7UUFDdEUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxRQUFRLEdBQUcsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSw2QkFBNkIsRUFBRTtZQUN0RSxTQUFTLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxTQUFTO1lBQ3ZDLGFBQWEsRUFBRSwyQkFBYSxDQUFDLE9BQU87U0FDckMsQ0FBQyxDQUFDO1FBRUgsTUFBTSxlQUFlLEdBQUcsK0NBQStDLEtBQUssQ0FBQyxNQUFNLENBQUMsY0FBYyxFQUFFLENBQUM7UUFFckcsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLEtBQUssQ0FBQyxhQUFhLENBQUMsSUFBSSxFQUFFLHdCQUF3QixFQUFFO1lBQy9FLEtBQUssRUFBRSxLQUFLLENBQUMsV0FBVztZQUN4QixJQUFJLEVBQUU7Z0JBQ0osRUFBRSxFQUFFLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxVQUFVLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUM7Z0JBQ2xGLFNBQVMsRUFBRSxLQUFLLENBQUMsb0JBQW9CLENBQUMsVUFBVSxDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLG1CQUFtQixDQUFDLENBQUM7Z0JBQ3RHLE1BQU0sRUFBRSxLQUFLLENBQUMsb0JBQW9CLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQztnQkFDdkQsS0FBSyxFQUFFLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxVQUFVLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztnQkFDL0YsS0FBSyxFQUFFLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQyxVQUFVLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsZ0JBQWdCLENBQUMsQ0FBQzthQUNoRztTQUNGLENBQUMsQ0FBQztRQUVILE1BQU0sbUJBQW1CLEdBQUcsSUFBSSxLQUFLLENBQUMsYUFBYSxDQUFDLElBQUksRUFBRSwyQkFBMkIsRUFBRTtZQUNyRixLQUFLLEVBQUUsS0FBSyxDQUFDLFdBQVc7WUFDeEIsSUFBSSxFQUFFO2dCQUNKLEVBQUUsRUFBRSxLQUFLLENBQUMsb0JBQW9CLENBQUMsVUFBVSxDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDO2dCQUNsRixTQUFTLEVBQUUsS0FBSyxDQUFDLG9CQUFvQixDQUFDLFVBQVUsQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDO2dCQUN0RyxNQUFNLEVBQUUsS0FBSyxDQUFDLG9CQUFvQixDQUFDLFVBQVUsQ0FBQyxXQUFXLENBQUM7YUFDM0Q7U0FDRixDQUFDLENBQUM7UUFFSCxNQUFNLHVCQUF1QixHQUFHLElBQUksS0FBSyxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsdUJBQXVCLEVBQUU7WUFDcEYsY0FBYyxFQUFFLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxvQkFBb0I7WUFDM0QsT0FBTyxFQUFFLGFBQWEsQ0FBQyxTQUFTLENBQUMsY0FBYyxDQUFDLEdBQUcsQ0FBQztZQUNwRCxVQUFVLEVBQUUsYUFBYSxDQUFDLFFBQVEsQ0FBQyxPQUFPO1NBQzNDLENBQUMsQ0FBQztRQUNILHVCQUF1QixDQUFDLFFBQVEsQ0FBQztZQUMvQixNQUFNLEVBQUU7Z0JBQ04seUJBQXlCO2dCQUN6QiwyQkFBMkI7Z0JBQzNCLDJCQUEyQjtnQkFDM0IsaUNBQWlDO2FBQ2xDO1lBQ0QsUUFBUSxFQUFFLHNCQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztZQUM3QixXQUFXLEVBQUUsQ0FBQztZQUNkLFdBQVcsRUFBRSxDQUFDO1NBQ2YsQ0FBQyxDQUFDO1FBQ0gsdUJBQXVCLENBQUMsUUFBUSxDQUFDLGdCQUFnQixFQUFFO1lBQ2pELFVBQVUsRUFBRSxVQUFVO1NBQ3ZCLENBQUMsQ0FBQztRQUVILE1BQU0saUJBQWlCLEdBQUcsSUFBSSxLQUFLLENBQUMsY0FBYyxDQUFDLElBQUksRUFBRSxxQkFBcUIsRUFBRTtZQUM5RSxPQUFPLEVBQUUsU0FBUztZQUNsQixNQUFNLEVBQUUsYUFBYTtZQUNyQixTQUFTLEVBQUUscUJBQXFCO1lBQ2hDLFlBQVksRUFBRSxDQUFDLGVBQWUsQ0FBQztZQUMvQixVQUFVLEVBQUU7Z0JBQ1YsT0FBTyxFQUFFLGVBQWU7Z0JBQ3hCLEtBQUssRUFBRTtvQkFDTCxLQUFLLEVBQUUsYUFBYSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQ2xDLG9CQUFvQixFQUNwQixhQUFhLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQUMsRUFDN0MsYUFBYSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsaUJBQWlCLENBQUMsRUFDbEQsYUFBYSxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQ2pDLGFBQWEsQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLG1CQUFtQixDQUFDLEVBQUUsR0FBRyxDQUFDLEVBQzdGLENBQUMsQ0FDRixDQUNGO2lCQUNGO2dCQUNELE1BQU0sRUFBRTtvQkFDTixLQUFLLEVBQUUsYUFBYSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQ2xDLG9CQUFvQixFQUNwQixhQUFhLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQUMsRUFDN0MsYUFBYSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsa0JBQWtCLENBQUMsRUFDbkQsYUFBYSxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQ2pDLGFBQWEsQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLG1CQUFtQixDQUFDLEVBQUUsR0FBRyxDQUFDLEVBQzdGLENBQUMsQ0FDRixDQUNGO2lCQUNGO2dCQUNELFdBQVcsRUFBRSxrQkFBa0I7YUFDaEM7WUFDRCxVQUFVLEVBQUUsVUFBVTtTQUN2QixDQUFDLENBQUM7UUFDSCxpQkFBaUIsQ0FBQyxRQUFRLENBQUMsZ0JBQWdCLEVBQUU7WUFDM0MsVUFBVSxFQUFFLFVBQVU7U0FDdkIsQ0FBQyxDQUFDO1FBRUgsTUFBTSx3QkFBd0IsR0FBRyxJQUFJLEtBQUssQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLHdCQUF3QixFQUFFO1lBQ3RGLGNBQWMsRUFBRSxLQUFLLENBQUMsZ0JBQWdCLENBQUMscUJBQXFCO1lBQzVELE9BQU8sRUFBRSxhQUFhLENBQUMsU0FBUyxDQUFDLGNBQWMsQ0FBQyxHQUFHLENBQUM7WUFDcEQsVUFBVSxFQUFFLGFBQWEsQ0FBQyxRQUFRLENBQUMsT0FBTztTQUMzQyxDQUFDLENBQUM7UUFDSCx3QkFBd0IsQ0FBQyxRQUFRLENBQUM7WUFDaEMsTUFBTSxFQUFFO2dCQUNOLHlCQUF5QjtnQkFDekIsMkJBQTJCO2dCQUMzQiwyQkFBMkI7Z0JBQzNCLGlDQUFpQzthQUNsQztZQUNELFFBQVEsRUFBRSxzQkFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7WUFDN0IsV0FBVyxFQUFFLENBQUM7WUFDZCxXQUFXLEVBQUUsQ0FBQztTQUNmLENBQUMsQ0FBQztRQUNILHdCQUF3QixDQUFDLFFBQVEsQ0FBQyxnQkFBZ0IsRUFBRTtZQUNsRCxVQUFVLEVBQUUsVUFBVTtTQUN2QixDQUFDLENBQUM7UUFFSCxNQUFNLEdBQUcsR0FBRyxJQUFJLGFBQWEsQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQ25FLFNBQVMsRUFBRSxhQUFhLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUM7WUFDdEQsWUFBWSxFQUFFO2dCQUNaLEVBQUUsRUFBRSxhQUFhLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUM7Z0JBQzNDLFFBQVEsRUFBRSxhQUFhLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQUM7Z0JBQ3ZELGFBQWEsRUFBRSxhQUFhLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQztnQkFDakUsY0FBYyxFQUFFLGFBQWEsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLGtCQUFrQixDQUFDO2dCQUNuRSxNQUFNLEVBQUUsYUFBYSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDO2dCQUNuRCxjQUFjLEVBQUUsYUFBYSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsa0JBQWtCLENBQUM7Z0JBQ25FLElBQUksRUFBRSxhQUFhLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUM7Z0JBQy9DLEtBQUssRUFBRSxhQUFhLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxtQkFBbUIsQ0FBQzthQUM1RDtZQUNELGNBQWMsRUFBRSxLQUFLLENBQUMsTUFBTSxDQUFDLGNBQWM7WUFDM0MsS0FBSyxFQUFFLEtBQUs7WUFDWiwwQkFBMEIsRUFBRSxFQUFFO1lBQzlCLFVBQVUsRUFBRSxhQUFhLENBQUMsUUFBUSxDQUFDLE9BQU87U0FDM0MsQ0FBQyxDQUFDO1FBRUgsR0FBRyxDQUFDLGFBQWEsQ0FDZix1QkFBdUI7YUFDcEIsSUFBSSxDQUFDLGlCQUFpQixDQUFDO2FBQ3ZCLElBQUksQ0FBQyx3QkFBd0IsQ0FBQzthQUM5QixJQUFJLENBQUMsbUJBQW1CLENBQUMsQ0FDN0IsQ0FBQztRQUVGLE1BQU0sd0JBQXdCLEdBQUcsSUFBSSxLQUFLLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSx3QkFBd0IsRUFBRTtZQUN0RixjQUFjLEVBQUUsS0FBSyxDQUFDLGdCQUFnQixDQUFDLG9CQUFvQjtZQUMzRCxPQUFPLEVBQUUsYUFBYSxDQUFDLFNBQVMsQ0FBQyxjQUFjLENBQUMsR0FBRyxDQUFDO1lBQ3BELGNBQWMsRUFBRTtnQkFDZCxTQUFTLEVBQUUsYUFBYSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMscUJBQXFCLENBQUM7Z0JBQ2pFLFdBQVcsRUFBRSxhQUFhLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyx1QkFBdUIsQ0FBQzthQUN0RTtZQUNELFVBQVUsRUFBRSxnQkFBZ0I7U0FDN0IsQ0FBQyxDQUFDO1FBQ0gsd0JBQXdCLENBQUMsUUFBUSxDQUFDO1lBQ2hDLE1BQU0sRUFBRTtnQkFDTix5QkFBeUI7Z0JBQ3pCLDJCQUEyQjtnQkFDM0IsMkJBQTJCO2dCQUMzQixpQ0FBaUM7YUFDbEM7WUFDRCxRQUFRLEVBQUUsc0JBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO1lBQzdCLFdBQVcsRUFBRSxDQUFDO1lBQ2QsV0FBVyxFQUFFLENBQUM7U0FDZixDQUFDLENBQUM7UUFFSCxNQUFNLGFBQWEsR0FBRyxJQUFJLEtBQUssQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUM3RCxLQUFLLEVBQUUsS0FBSyxDQUFDLFFBQVE7WUFDckIsT0FBTyxFQUFFLGFBQWEsQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUN2QyxhQUFhLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FDM0IsbVRBQW1ULEVBQ25ULGFBQWEsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLFlBQVksQ0FBQyxFQUM3QyxhQUFhLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxrQkFBa0IsQ0FBQyxFQUNuRCxhQUFhLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQUMsRUFDN0MsYUFBYSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsa0JBQWtCLENBQUMsQ0FDcEQsQ0FDRjtZQUNELE9BQU8sRUFBRSxzREFBc0Q7WUFDL0QsVUFBVSxFQUFFLGFBQWEsQ0FBQyxRQUFRLENBQUMsT0FBTztTQUMzQyxDQUFDLENBQUM7UUFFSCxHQUFHLENBQUMsSUFBSSxDQUFDLHdCQUF3QixDQUFDLENBQUM7UUFDbkMsd0JBQXdCLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxDQUFDO1FBRTdDLE1BQU0sVUFBVSxHQUFHLEdBQUcsQ0FBQztRQUV2QixNQUFNLFlBQVksR0FBRyxJQUFJLGFBQWEsQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLHlCQUF5QixFQUFFO1lBQ25GLGdCQUFnQixFQUFFLEtBQUssQ0FBQyxNQUFNLENBQUMsMkJBQTJCO1lBQzFELGNBQWMsRUFBRSxhQUFhLENBQUMsY0FBYyxDQUFDLGFBQWEsQ0FBQyxVQUFVLENBQUM7WUFDdEUsY0FBYyxFQUFFLElBQUk7WUFDcEIsSUFBSSxFQUFFO2dCQUNKLFdBQVcsRUFBRSxRQUFRO2dCQUNyQixLQUFLLEVBQUUsYUFBYSxDQUFDLFFBQVEsQ0FBQyxHQUFHO2dCQUNqQyxvQkFBb0IsRUFBRSxJQUFJO2FBQzNCO1lBQ0QsT0FBTyxFQUFFLHNCQUFRLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztTQUM5QixDQUFDLENBQUM7UUFFSCxZQUFZLENBQUMsZUFBZSxDQUFDLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztZQUNuRCxPQUFPLEVBQUUsQ0FBQyxxQkFBcUIsQ0FBQztZQUNoQyxTQUFTLEVBQUUsQ0FBQyxlQUFlLENBQUM7U0FDN0IsQ0FBQyxDQUFDLENBQUM7UUFFSixZQUFZLENBQUMsZUFBZSxDQUFDLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztZQUNuRCxPQUFPLEVBQUUsQ0FBQyx1QkFBdUIsQ0FBQztZQUNsQyxTQUFTLEVBQUU7Z0JBQ1QsS0FBSyxDQUFDLGdCQUFnQixDQUFDLG9CQUFvQixDQUFDLFdBQVc7Z0JBQ3ZELEdBQUcsS0FBSyxDQUFDLGdCQUFnQixDQUFDLG9CQUFvQixDQUFDLFdBQVcsSUFBSTtnQkFDOUQsS0FBSyxDQUFDLGdCQUFnQixDQUFDLHFCQUFxQixDQUFDLFdBQVc7Z0JBQ3hELEdBQUcsS0FBSyxDQUFDLGdCQUFnQixDQUFDLHFCQUFxQixDQUFDLFdBQVcsSUFBSTtnQkFDL0QsS0FBSyxDQUFDLGdCQUFnQixDQUFDLG9CQUFvQixDQUFDLFdBQVc7Z0JBQ3ZELEdBQUcsS0FBSyxDQUFDLGdCQUFnQixDQUFDLG9CQUFvQixDQUFDLFdBQVcsSUFBSTthQUMvRDtTQUNGLENBQUMsQ0FBQyxDQUFDO1FBRUosWUFBWSxDQUFDLGVBQWUsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7WUFDbkQsT0FBTyxFQUFFLENBQUMsa0JBQWtCLENBQUM7WUFDN0IsU0FBUyxFQUFFLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxRQUFRLENBQUM7U0FDeEMsQ0FBQyxDQUFDLENBQUM7UUFFSixZQUFZLENBQUMsZUFBZSxDQUFDLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztZQUNuRCxPQUFPLEVBQUUsQ0FBQyxhQUFhLENBQUM7WUFDeEIsU0FBUyxFQUFFLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUM7U0FDckMsQ0FBQyxDQUFDLENBQUM7UUFFSixZQUFZLENBQUMsZUFBZSxDQUFDLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztZQUNuRCxPQUFPLEVBQUUsQ0FBQyxjQUFjLEVBQUUsY0FBYyxFQUFFLHlCQUF5QixFQUFFLDZCQUE2QixDQUFDO1lBQ25HLFNBQVMsRUFBRSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1NBQzdDLENBQUMsQ0FBQyxDQUFDO1FBRUosWUFBWSxDQUFDLGVBQWUsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7WUFDbkQsT0FBTyxFQUFFO2dCQUNQLHVCQUF1QjtnQkFDdkIsMEJBQTBCO2dCQUMxQix1QkFBdUI7Z0JBQ3ZCLHlCQUF5QjthQUMxQjtZQUNELFNBQVMsRUFBRSxDQUFDLEdBQUcsQ0FBQztTQUNqQixDQUFDLENBQUMsQ0FBQztRQUVKLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxxQkFBcUIsQ0FBQyxjQUFjLENBQ3pELG9DQUFvQyxFQUNwQyxZQUFZLENBQUMsZUFBZSxDQUM3QixDQUFDO1FBQ0YsWUFBWSxDQUFDLG1CQUFtQixDQUFDLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDO1FBRS9FLElBQUEsbUJBQVcsRUFBQyxJQUFJLENBQUMsQ0FBQztRQUNsQiw0QkFBb0IsQ0FBQyx1QkFBdUIsQ0FBQyxJQUFJLEVBQUUscUJBQXFCLENBQUMsQ0FBQztRQUMxRSw0QkFBb0IsQ0FBQyw4QkFBOEIsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUUxRCxJQUFJLENBQUMsT0FBTyxHQUFHO1lBQ2IsWUFBWTtTQUNiLENBQUM7SUFDSixDQUFDO0NBQ0Y7QUFwUEQsZ0RBb1BDIiwic291cmNlc0NvbnRlbnQiOlsiIyEvdXNyL2Jpbi9lbnYgbm9kZVxuXG4vKipcbiAqIE9yY2hlc3RyYXRpb24gU3RhY2sgZm9yIHRoZSBJbWFnZSBQcm9jZXNzaW5nIGFwcGxpY2F0aW9uLlxuICogTWFuYWdlcyB0aGUgU3RlcCBGdW5jdGlvbnMgd29ya2Zsb3cgdGhhdCBjb29yZGluYXRlcyBCZWRyb2NrLCBMYW1iZGEsIER5bmFtb0RCLCBhbmQgU05TLlxuICovXG5cbmltcG9ydCB7IER1cmF0aW9uLCBSZW1vdmFsUG9saWN5LCBTdGFjayB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0ICogYXMgc3RlcGZ1bmN0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3RlcGZ1bmN0aW9ucyc7XG5pbXBvcnQgKiBhcyB0YXNrcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3RlcGZ1bmN0aW9ucy10YXNrcyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IE9yY2hlc3RyYXRpb25TdGFja091dHB1dHMsIE9yY2hlc3RyYXRpb25TdGFja1Byb3BzIH0gZnJvbSAnLi4vdHlwZXMnO1xuaW1wb3J0IHsgYXBwbHlDZGtOYWcsIFNlY3VyaXR5U3VwcHJlc3Npb25zIH0gZnJvbSAnLi4vdXRpbHMnO1xuXG5leHBvcnQgY2xhc3MgT3JjaGVzdHJhdGlvblN0YWNrIGV4dGVuZHMgU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgb3V0cHV0czogT3JjaGVzdHJhdGlvblN0YWNrT3V0cHV0cztcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogT3JjaGVzdHJhdGlvblN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IGxvZ0dyb3VwID0gbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgJ0ltYWdlUHJvY2Vzc2luZ1dvcmtmbG93TG9ncycsIHtcbiAgICAgIHJldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWVxuICAgIH0pO1xuXG4gICAgY29uc3QgYmVkcm9ja01vZGVsQXJuID0gYGFybjphd3M6YmVkcm9jazp1cy1lYXN0LTE6OmZvdW5kYXRpb24tbW9kZWwvJHtwcm9wcy5jb25maWcuYmVkcm9ja01vZGVsSWR9YDtcblxuICAgIGNvbnN0IHVwZGF0ZUZhaWxlZFRhc2sgPSBuZXcgdGFza3MuRHluYW1vUHV0SXRlbSh0aGlzLCBcIlVwZGF0ZSAnRmFpbGVkJyBTdGF0dXNcIiwge1xuICAgICAgdGFibGU6IHByb3BzLnN0YXR1c1RhYmxlLFxuICAgICAgaXRlbToge1xuICAgICAgICBJZDogdGFza3MuRHluYW1vQXR0cmlidXRlVmFsdWUuZnJvbVN0cmluZyhzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLklkJykpLFxuICAgICAgICBJbWFnZU5hbWU6IHRhc2tzLkR5bmFtb0F0dHJpYnV0ZVZhbHVlLmZyb21TdHJpbmcoc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5JbWFnZS5JbWFnZU5hbWUnKSksXG4gICAgICAgIFN0YXR1czogdGFza3MuRHluYW1vQXR0cmlidXRlVmFsdWUuZnJvbVN0cmluZygnRmFpbGVkJyksXG4gICAgICAgIEVycm9yOiB0YXNrcy5EeW5hbW9BdHRyaWJ1dGVWYWx1ZS5mcm9tU3RyaW5nKHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQuU3RhdHVzLkVycm9yJykpLFxuICAgICAgICBDYXVzZTogdGFza3MuRHluYW1vQXR0cmlidXRlVmFsdWUuZnJvbVN0cmluZyhzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLlN0YXR1cy5DYXVzZScpKVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgdXBkYXRlU3VjY2VlZGVkVGFzayA9IG5ldyB0YXNrcy5EeW5hbW9QdXRJdGVtKHRoaXMsIFwiVXBkYXRlICdTdWNjZWVkZWQnIFN0YXR1c1wiLCB7XG4gICAgICB0YWJsZTogcHJvcHMuc3RhdHVzVGFibGUsXG4gICAgICBpdGVtOiB7XG4gICAgICAgIElkOiB0YXNrcy5EeW5hbW9BdHRyaWJ1dGVWYWx1ZS5mcm9tU3RyaW5nKHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQuSWQnKSksXG4gICAgICAgIEltYWdlTmFtZTogdGFza3MuRHluYW1vQXR0cmlidXRlVmFsdWUuZnJvbVN0cmluZyhzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLkltYWdlLkltYWdlTmFtZScpKSxcbiAgICAgICAgU3RhdHVzOiB0YXNrcy5EeW5hbW9BdHRyaWJ1dGVWYWx1ZS5mcm9tU3RyaW5nKCdTdWNjZWVkZWQnKVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29uc3QgYnVpbGRCZWRyb2NrUmVxdWVzdFRhc2sgPSBuZXcgdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdCdWlsZCBCZWRyb2NrIFJlcXVlc3QnLCB7XG4gICAgICBsYW1iZGFGdW5jdGlvbjogcHJvcHMuY29tcHV0ZUZ1bmN0aW9ucy5idWlsZFJlcXVlc3RGdW5jdGlvbixcbiAgICAgIHBheWxvYWQ6IHN0ZXBmdW5jdGlvbnMuVGFza0lucHV0LmZyb21Kc29uUGF0aEF0KCckJyksXG4gICAgICByZXN1bHRQYXRoOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLkRJU0NBUkRcbiAgICB9KTtcbiAgICBidWlsZEJlZHJvY2tSZXF1ZXN0VGFzay5hZGRSZXRyeSh7XG4gICAgICBlcnJvcnM6IFtcbiAgICAgICAgJ0xhbWJkYS5TZXJ2aWNlRXhjZXB0aW9uJyxcbiAgICAgICAgJ0xhbWJkYS5BV1NMYW1iZGFFeGNlcHRpb24nLFxuICAgICAgICAnTGFtYmRhLlNka0NsaWVudEV4Y2VwdGlvbicsXG4gICAgICAgICdMYW1iZGEuVG9vTWFueVJlcXVlc3RzRXhjZXB0aW9uJ1xuICAgICAgXSxcbiAgICAgIGludGVydmFsOiBEdXJhdGlvbi5zZWNvbmRzKDEpLFxuICAgICAgbWF4QXR0ZW1wdHM6IDMsXG4gICAgICBiYWNrb2ZmUmF0ZTogMlxuICAgIH0pO1xuICAgIGJ1aWxkQmVkcm9ja1JlcXVlc3RUYXNrLmFkZENhdGNoKHVwZGF0ZUZhaWxlZFRhc2ssIHtcbiAgICAgIHJlc3VsdFBhdGg6ICckLlN0YXR1cydcbiAgICB9KTtcblxuICAgIGNvbnN0IGJlZHJvY2tJbnZva2VUYXNrID0gbmV3IHRhc2tzLkNhbGxBd3NTZXJ2aWNlKHRoaXMsICdCZWRyb2NrIEludm9rZU1vZGVsJywge1xuICAgICAgc2VydmljZTogJ2JlZHJvY2snLFxuICAgICAgYWN0aW9uOiAnaW52b2tlTW9kZWwnLFxuICAgICAgaWFtQWN0aW9uOiAnYmVkcm9jazpJbnZva2VNb2RlbCcsXG4gICAgICBpYW1SZXNvdXJjZXM6IFtiZWRyb2NrTW9kZWxBcm5dLFxuICAgICAgcGFyYW1ldGVyczoge1xuICAgICAgICBNb2RlbElkOiBiZWRyb2NrTW9kZWxBcm4sXG4gICAgICAgIElucHV0OiB7XG4gICAgICAgICAgUzNVcmk6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguZm9ybWF0KFxuICAgICAgICAgICAgJ3MzOi8ve30ve30ve30uanNvbicsXG4gICAgICAgICAgICBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLlMzQnVja2V0JyksXG4gICAgICAgICAgICBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLklucHV0UzNQcmVmaXgnKSxcbiAgICAgICAgICAgIHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguYXJyYXlHZXRJdGVtKFxuICAgICAgICAgICAgICBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ1NwbGl0KHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQuSW1hZ2UuSW1hZ2VOYW1lJyksICcuJyksXG4gICAgICAgICAgICAgIDBcbiAgICAgICAgICAgIClcbiAgICAgICAgICApXG4gICAgICAgIH0sXG4gICAgICAgIE91dHB1dDoge1xuICAgICAgICAgIFMzVXJpOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLmZvcm1hdChcbiAgICAgICAgICAgICdzMzovL3t9L3t9L3t9Lmpzb24nLFxuICAgICAgICAgICAgc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5TM0J1Y2tldCcpLFxuICAgICAgICAgICAgc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5PdXRwdXRTM1ByZWZpeCcpLFxuICAgICAgICAgICAgc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5hcnJheUdldEl0ZW0oXG4gICAgICAgICAgICAgIHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nU3BsaXQoc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5JbWFnZS5JbWFnZU5hbWUnKSwgJy4nKSxcbiAgICAgICAgICAgICAgMFxuICAgICAgICAgICAgKVxuICAgICAgICAgIClcbiAgICAgICAgfSxcbiAgICAgICAgQ29udGVudFR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJ1xuICAgICAgfSxcbiAgICAgIHJlc3VsdFBhdGg6ICckLm91dHB1dCdcbiAgICB9KTtcbiAgICBiZWRyb2NrSW52b2tlVGFzay5hZGRDYXRjaCh1cGRhdGVGYWlsZWRUYXNrLCB7XG4gICAgICByZXN1bHRQYXRoOiAnJC5TdGF0dXMnXG4gICAgfSk7XG5cbiAgICBjb25zdCBwYXJzZUJlZHJvY2tSZXNwb25zZVRhc2sgPSBuZXcgdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdQYXJzZSBCZWRyb2NrIFJlc3BvbnNlJywge1xuICAgICAgbGFtYmRhRnVuY3Rpb246IHByb3BzLmNvbXB1dGVGdW5jdGlvbnMucGFyc2VSZXNwb25zZUZ1bmN0aW9uLFxuICAgICAgcGF5bG9hZDogc3RlcGZ1bmN0aW9ucy5UYXNrSW5wdXQuZnJvbUpzb25QYXRoQXQoJyQnKSxcbiAgICAgIHJlc3VsdFBhdGg6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguRElTQ0FSRFxuICAgIH0pO1xuICAgIHBhcnNlQmVkcm9ja1Jlc3BvbnNlVGFzay5hZGRSZXRyeSh7XG4gICAgICBlcnJvcnM6IFtcbiAgICAgICAgJ0xhbWJkYS5TZXJ2aWNlRXhjZXB0aW9uJyxcbiAgICAgICAgJ0xhbWJkYS5BV1NMYW1iZGFFeGNlcHRpb24nLFxuICAgICAgICAnTGFtYmRhLlNka0NsaWVudEV4Y2VwdGlvbicsXG4gICAgICAgICdMYW1iZGEuVG9vTWFueVJlcXVlc3RzRXhjZXB0aW9uJ1xuICAgICAgXSxcbiAgICAgIGludGVydmFsOiBEdXJhdGlvbi5zZWNvbmRzKDEpLFxuICAgICAgbWF4QXR0ZW1wdHM6IDMsXG4gICAgICBiYWNrb2ZmUmF0ZTogMlxuICAgIH0pO1xuICAgIHBhcnNlQmVkcm9ja1Jlc3BvbnNlVGFzay5hZGRDYXRjaCh1cGRhdGVGYWlsZWRUYXNrLCB7XG4gICAgICByZXN1bHRQYXRoOiAnJC5TdGF0dXMnXG4gICAgfSk7XG5cbiAgICBjb25zdCBtYXAgPSBuZXcgc3RlcGZ1bmN0aW9ucy5EaXN0cmlidXRlZE1hcCh0aGlzLCAnUHJvY2VzcyBJbWFnZXMnLCB7XG4gICAgICBpdGVtc1BhdGg6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQuSW1hZ2VzJyksXG4gICAgICBpdGVtU2VsZWN0b3I6IHtcbiAgICAgICAgSWQ6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQuSWQnKSxcbiAgICAgICAgUzNCdWNrZXQ6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQuUzNCdWNrZXQnKSxcbiAgICAgICAgSW5wdXRTM1ByZWZpeDogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5JbnB1dFMzUHJlZml4JyksXG4gICAgICAgIE91dHB1dFMzUHJlZml4OiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLk91dHB1dFMzUHJlZml4JyksXG4gICAgICAgIFByb21wdDogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5Qcm9tcHQnKSxcbiAgICAgICAgTmVnYXRpdmVQcm9tcHQ6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQuTmVnYXRpdmVQcm9tcHQnKSxcbiAgICAgICAgTW9kZTogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5Nb2RlJyksXG4gICAgICAgIEltYWdlOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLm9iamVjdEF0KCckJC5NYXAuSXRlbS5WYWx1ZScpXG4gICAgICB9LFxuICAgICAgbWF4Q29uY3VycmVuY3k6IHByb3BzLmNvbmZpZy5tYXhDb25jdXJyZW5jeSxcbiAgICAgIGxhYmVsOiAnTWFwJyxcbiAgICAgIHRvbGVyYXRlZEZhaWx1cmVQZXJjZW50YWdlOiA5MCxcbiAgICAgIHJlc3VsdFBhdGg6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguRElTQ0FSRFxuICAgIH0pO1xuXG4gICAgbWFwLml0ZW1Qcm9jZXNzb3IoXG4gICAgICBidWlsZEJlZHJvY2tSZXF1ZXN0VGFza1xuICAgICAgICAubmV4dChiZWRyb2NrSW52b2tlVGFzaylcbiAgICAgICAgLm5leHQocGFyc2VCZWRyb2NrUmVzcG9uc2VUYXNrKVxuICAgICAgICAubmV4dCh1cGRhdGVTdWNjZWVkZWRUYXNrKVxuICAgICk7XG5cbiAgICBjb25zdCBnZW5lcmF0ZVN0YXR1c1JlcG9ydFRhc2sgPSBuZXcgdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdHZW5lcmF0ZSBTdGF0dXMgUmVwb3J0Jywge1xuICAgICAgbGFtYmRhRnVuY3Rpb246IHByb3BzLmNvbXB1dGVGdW5jdGlvbnMuc3RhdHVzUmVwb3J0RnVuY3Rpb24sXG4gICAgICBwYXlsb2FkOiBzdGVwZnVuY3Rpb25zLlRhc2tJbnB1dC5mcm9tSnNvblBhdGhBdCgnJCcpLFxuICAgICAgcmVzdWx0U2VsZWN0b3I6IHtcbiAgICAgICAgUmVwb3J0VVJMOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLlBheWxvYWQuUmVwb3J0VVJMJyksXG4gICAgICAgIFJlcG9ydFMzS2V5OiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLlBheWxvYWQuUmVwb3J0UzNLZXknKVxuICAgICAgfSxcbiAgICAgIHJlc3VsdFBhdGg6ICckLlN0YXR1c1JlcG9ydCdcbiAgICB9KTtcbiAgICBnZW5lcmF0ZVN0YXR1c1JlcG9ydFRhc2suYWRkUmV0cnkoe1xuICAgICAgZXJyb3JzOiBbXG4gICAgICAgICdMYW1iZGEuU2VydmljZUV4Y2VwdGlvbicsXG4gICAgICAgICdMYW1iZGEuQVdTTGFtYmRhRXhjZXB0aW9uJyxcbiAgICAgICAgJ0xhbWJkYS5TZGtDbGllbnRFeGNlcHRpb24nLFxuICAgICAgICAnTGFtYmRhLlRvb01hbnlSZXF1ZXN0c0V4Y2VwdGlvbidcbiAgICAgIF0sXG4gICAgICBpbnRlcnZhbDogRHVyYXRpb24uc2Vjb25kcygxKSxcbiAgICAgIG1heEF0dGVtcHRzOiAzLFxuICAgICAgYmFja29mZlJhdGU6IDJcbiAgICB9KTtcblxuICAgIGNvbnN0IHNlbmRFbWFpbFRhc2sgPSBuZXcgdGFza3MuU25zUHVibGlzaCh0aGlzLCAnU2VuZCBFbWFpbCcsIHtcbiAgICAgIHRvcGljOiBwcm9wcy5zbnNUb3BpYyxcbiAgICAgIG1lc3NhZ2U6IHN0ZXBmdW5jdGlvbnMuVGFza0lucHV0LmZyb21UZXh0KFxuICAgICAgICBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLmZvcm1hdChcbiAgICAgICAgICAnSGksXFxuXFxuV2UgYXJlIHBsZWFzZWQgdG8gaW5mb3JtIHlvdSB0aGF0IHRoZSBpbWFnZSBwcm9jZXNzaW5nIGhhcyBiZWVuIHN1Y2Nlc3NmdWxseSBjb21wbGV0ZWQuXFxuXFxuWW91IGNhbiBhY2Nlc3MgdGhlIHN0YXR1cyByZXBvcnQgYXQgdGhlIGZvbGxvd2luZyBsaW5rOiBcXG5zMzovL3t9L3t9L1xcblxcbkFsbCBwcm9jZXNzZWQgaW1hZ2VzIGNhbiBiZSBmb3VuZCBpbiB0aGUgUzMgYnVja2V0IGF0IHRoZSBmb2xsb3dpbmcgbG9jYXRpb246XFxuXFxuczM6Ly97fS97fS9cXG5cXG5UaGFuayB5b3UuXFxuXFxuQmVzdCByZWdhcmRzLFxcblxcbklUIFRlYW0nLFxuICAgICAgICAgIHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQuUzNCdWNrZXQnKSxcbiAgICAgICAgICBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLlN0YXR1c1MzUHJlZml4JyksXG4gICAgICAgICAgc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5TM0J1Y2tldCcpLFxuICAgICAgICAgIHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQuT3V0cHV0UzNQcmVmaXgnKVxuICAgICAgICApXG4gICAgICApLFxuICAgICAgc3ViamVjdDogJ0ltYWdlIFByb2Nlc3NpbmcgQ29tcGxldGVkIC0gU3RhdHVzIFJlcG9ydCBBdmFpbGFibGUnLFxuICAgICAgcmVzdWx0UGF0aDogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5ESVNDQVJEXG4gICAgfSk7XG5cbiAgICBtYXAubmV4dChnZW5lcmF0ZVN0YXR1c1JlcG9ydFRhc2spO1xuICAgIGdlbmVyYXRlU3RhdHVzUmVwb3J0VGFzay5uZXh0KHNlbmRFbWFpbFRhc2spO1xuXG4gICAgY29uc3QgZGVmaW5pdGlvbiA9IG1hcDtcblxuICAgIGNvbnN0IHN0YXRlTWFjaGluZSA9IG5ldyBzdGVwZnVuY3Rpb25zLlN0YXRlTWFjaGluZSh0aGlzLCAnSW1hZ2VQcm9jZXNzaW5nV29ya2Zsb3cnLCB7XG4gICAgICBzdGF0ZU1hY2hpbmVOYW1lOiBwcm9wcy5jb25maWcuaW1hZ2VQcm9jZXNzaW5nV29ya2Zsb3dOYW1lLFxuICAgICAgZGVmaW5pdGlvbkJvZHk6IHN0ZXBmdW5jdGlvbnMuRGVmaW5pdGlvbkJvZHkuZnJvbUNoYWluYWJsZShkZWZpbml0aW9uKSxcbiAgICAgIHRyYWNpbmdFbmFibGVkOiB0cnVlLFxuICAgICAgbG9nczoge1xuICAgICAgICBkZXN0aW5hdGlvbjogbG9nR3JvdXAsXG4gICAgICAgIGxldmVsOiBzdGVwZnVuY3Rpb25zLkxvZ0xldmVsLkFMTCxcbiAgICAgICAgaW5jbHVkZUV4ZWN1dGlvbkRhdGE6IHRydWVcbiAgICAgIH0sXG4gICAgICB0aW1lb3V0OiBEdXJhdGlvbi5taW51dGVzKDE1KVxuICAgIH0pO1xuXG4gICAgc3RhdGVNYWNoaW5lLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ2JlZHJvY2s6SW52b2tlTW9kZWwnXSxcbiAgICAgIHJlc291cmNlczogW2JlZHJvY2tNb2RlbEFybl1cbiAgICB9KSk7XG5cbiAgICBzdGF0ZU1hY2hpbmUuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnbGFtYmRhOkludm9rZUZ1bmN0aW9uJ10sXG4gICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgcHJvcHMuY29tcHV0ZUZ1bmN0aW9ucy5idWlsZFJlcXVlc3RGdW5jdGlvbi5mdW5jdGlvbkFybixcbiAgICAgICAgYCR7cHJvcHMuY29tcHV0ZUZ1bmN0aW9ucy5idWlsZFJlcXVlc3RGdW5jdGlvbi5mdW5jdGlvbkFybn06KmAsXG4gICAgICAgIHByb3BzLmNvbXB1dGVGdW5jdGlvbnMucGFyc2VSZXNwb25zZUZ1bmN0aW9uLmZ1bmN0aW9uQXJuLFxuICAgICAgICBgJHtwcm9wcy5jb21wdXRlRnVuY3Rpb25zLnBhcnNlUmVzcG9uc2VGdW5jdGlvbi5mdW5jdGlvbkFybn06KmAsXG4gICAgICAgIHByb3BzLmNvbXB1dGVGdW5jdGlvbnMuc3RhdHVzUmVwb3J0RnVuY3Rpb24uZnVuY3Rpb25Bcm4sXG4gICAgICAgIGAke3Byb3BzLmNvbXB1dGVGdW5jdGlvbnMuc3RhdHVzUmVwb3J0RnVuY3Rpb24uZnVuY3Rpb25Bcm59OipgXG4gICAgICBdXG4gICAgfSkpO1xuXG4gICAgc3RhdGVNYWNoaW5lLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ2R5bmFtb2RiOlB1dEl0ZW0nXSxcbiAgICAgIHJlc291cmNlczogW3Byb3BzLnN0YXR1c1RhYmxlLnRhYmxlQXJuXVxuICAgIH0pKTtcblxuICAgIHN0YXRlTWFjaGluZS5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydzbnM6UHVibGlzaCddLFxuICAgICAgcmVzb3VyY2VzOiBbcHJvcHMuc25zVG9waWMudG9waWNBcm5dXG4gICAgfSkpO1xuXG4gICAgc3RhdGVNYWNoaW5lLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ3MzOkdldE9iamVjdCcsICdzMzpQdXRPYmplY3QnLCAnczM6QWJvcnRNdWx0aXBhcnRVcGxvYWQnLCAnczM6TGlzdE11bHRpcGFydFVwbG9hZFBhcnRzJ10sXG4gICAgICByZXNvdXJjZXM6IFtwcm9wcy5idWNrZXQuYXJuRm9yT2JqZWN0cygnKicpXVxuICAgIH0pKTtcblxuICAgIHN0YXRlTWFjaGluZS5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogW1xuICAgICAgICAneHJheTpQdXRUcmFjZVNlZ21lbnRzJyxcbiAgICAgICAgJ3hyYXk6UHV0VGVsZW1ldHJ5UmVjb3JkcycsXG4gICAgICAgICd4cmF5OkdldFNhbXBsaW5nUnVsZXMnLFxuICAgICAgICAneHJheTpHZXRTYW1wbGluZ1RhcmdldHMnXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXVxuICAgIH0pKTtcblxuICAgIHByb3BzLmNvbXB1dGVGdW5jdGlvbnMuc3RhcnRXb3JrZmxvd0Z1bmN0aW9uLmFkZEVudmlyb25tZW50KFxuICAgICAgJ1NUQVRFX01BQ0hJTkVfSU1BR0VfUFJPQ0VTU0lOR19BUk4nLFxuICAgICAgc3RhdGVNYWNoaW5lLnN0YXRlTWFjaGluZUFyblxuICAgICk7XG4gICAgc3RhdGVNYWNoaW5lLmdyYW50U3RhcnRFeGVjdXRpb24ocHJvcHMuY29tcHV0ZUZ1bmN0aW9ucy5zdGFydFdvcmtmbG93RnVuY3Rpb24pO1xuXG4gICAgYXBwbHlDZGtOYWcodGhpcyk7XG4gICAgU2VjdXJpdHlTdXBwcmVzc2lvbnMuYXBwbHlDb21tb25TdXBwcmVzc2lvbnModGhpcywgJ09yY2hlc3RyYXRpb24gU3RhY2snKTtcbiAgICBTZWN1cml0eVN1cHByZXNzaW9ucy5hcHBseVN0ZXBGdW5jdGlvbnNTdXBwcmVzc2lvbnModGhpcyk7XG5cbiAgICB0aGlzLm91dHB1dHMgPSB7XG4gICAgICBzdGF0ZU1hY2hpbmVcbiAgICB9O1xuICB9XG59XG4iXX0=