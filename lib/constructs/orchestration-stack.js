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
const path = __importStar(require("path"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const stepfunctions = __importStar(require("aws-cdk-lib/aws-stepfunctions"));
const utils_1 = require("../utils");
class OrchestrationStack extends aws_cdk_lib_1.Stack {
    outputs;
    constructor(scope, id, props) {
        super(scope, id, props);
        const definitionBody = stepfunctions.DefinitionBody.fromFile(path.join(__dirname, '..', '..', 'statemachine', 'image-processing-workflow.asl.json'));
        const logGroup = new logs.LogGroup(this, 'ImageProcessingWorkflowLogs', {
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY
        });
        const bedrockModelArn = `arn:aws:bedrock:us-east-1::foundation-model/${props.config.bedrockModelId}`;
        const stateMachine = new stepfunctions.StateMachine(this, 'ImageProcessingWorkflow', {
            stateMachineName: props.config.imageProcessingWorkflowName,
            definitionBody,
            definitionSubstitutions: {
                MaxConcurrency: props.config.maxConcurrency.toString(),
                BuildBedrockRequestFunctionArn: props.computeFunctions.buildRequestFunction.functionArn,
                ParseBedrockResponseFunctionArn: props.computeFunctions.parseResponseFunction.functionArn,
                GenerateStatusReportFunctionArn: props.computeFunctions.statusReportFunction.functionArn,
                StatusTableName: props.statusTable.tableName,
                NotificationSNSTopicArn: props.snsTopic.topicArn,
                BedrockModelArn: bedrockModelArn
            },
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3JjaGVzdHJhdGlvbi1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm9yY2hlc3RyYXRpb24tc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFFQTs7O0dBR0c7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBRUgsMkNBQTZCO0FBQzdCLDZDQUE2RDtBQUM3RCx5REFBMkM7QUFDM0MsMkRBQTZDO0FBQzdDLDZFQUErRDtBQUcvRCxvQ0FBNkQ7QUFFN0QsTUFBYSxrQkFBbUIsU0FBUSxtQkFBSztJQUMzQixPQUFPLENBQTRCO0lBRW5ELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBOEI7UUFDdEUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxjQUFjLEdBQUcsYUFBYSxDQUFDLGNBQWMsQ0FBQyxRQUFRLENBQzFELElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsY0FBYyxFQUFFLG9DQUFvQyxDQUFDLENBQ3ZGLENBQUM7UUFFRixNQUFNLFFBQVEsR0FBRyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLDZCQUE2QixFQUFFO1lBQ3RFLFNBQVMsRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVM7WUFDdkMsYUFBYSxFQUFFLDJCQUFhLENBQUMsT0FBTztTQUNyQyxDQUFDLENBQUM7UUFFSCxNQUFNLGVBQWUsR0FBRywrQ0FBK0MsS0FBSyxDQUFDLE1BQU0sQ0FBQyxjQUFjLEVBQUUsQ0FBQztRQUVyRyxNQUFNLFlBQVksR0FBRyxJQUFJLGFBQWEsQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLHlCQUF5QixFQUFFO1lBQ25GLGdCQUFnQixFQUFFLEtBQUssQ0FBQyxNQUFNLENBQUMsMkJBQTJCO1lBQzFELGNBQWM7WUFDZCx1QkFBdUIsRUFBRTtnQkFDdkIsY0FBYyxFQUFFLEtBQUssQ0FBQyxNQUFNLENB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QUN6RCxvQ0FBb0MsRUFDcEMsWUFBWSxDQUFDLGVBQWUsQ0FDN0IsQ0FBQztRQUNGLFlBQVksQ0FBQyxtQkFBbUIsQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLENBQUMscUJBQXFCLENBQUMsQ0FBQztRQUUvRSxJQUFBLG1CQUFXLEVBQUMsSUFBSSxDQUFDLENBQUM7UUFDbEIsNEJBQW9CLENBQUMsdUJBQXVCLENBQUMsSUFBSSxFQUFFLHFCQUFxQixDQUFDLENBQUM7UUFDMUUsNEJBQW9CLENBQUMsOEJBQThCLENBQUMsSUFBSSxDQUFDLENBQUM7UUFFMUQsSUFBSSxDQUFDLE9BQU8sR0FBRztZQUNiLFlBQVk7U0FDYixDQUFDO0lBQ0osQ0FBQztDQUNGO0FBOUZELGdEQThGQyIsInNvdXJjZXNDb250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5vZGVcblxuLyoqXG4gKiBPcmNoZXN0cmF0aW9uIFN0YWNrIGZvciB0aGUgSW1hZ2UgUHJvY2Vzc2luZyBhcHBsaWNhdGlvbi5cbiAqIE1hbmFnZXMgdGhlIFN0ZXAgRnVuY3Rpb25zIHdvcmtmbG93IHRoYXQgY29vcmRpbmF0ZXMgQmVkcm9jaywgTGFtYmRhLCBEeW5hbW9EQiwgYW5kIFNOUy5cbiAqL1xuXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgRHVyYXRpb24sIFJlbW92YWxQb2xpY3ksIFN0YWNrIH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgKiBhcyBzdGVwZnVuY3Rpb25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zdGVwZnVuY3Rpb25zJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgT3JjaGVzdHJhdGlvblN0YWNrT3V0cHV0cywgT3JjaGVzdHJhdGlvblN0YWNrUHJvcHMgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyBhcHBseUNka05hZywgU2VjdXJpdHlTdXBwcmVzc2lvbnMgfSBmcm9tICcuLi91dGlscyc7XG5cbmV4cG9ydCBjbGFzcyBPcmNoZXN0cmF0aW9uU3RhY2sgZXh0ZW5kcyBTdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSBvdXRwdXRzOiBPcmNoZXN0cmF0aW9uU3RhY2tPdXRwdXRzO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBPcmNoZXN0cmF0aW9uU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3QgZGVmaW5pdGlvbkJvZHkgPSBzdGVwZnVuY3Rpb25zLkRlZmluaXRpb25Cb2R5LmZyb21GaWxlKFxuICAgICAgcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uJywgJy4uJywgJ3N0YXRlbWFjaGluZScsICdpbWFnZS1wcm9jZXNzaW5nLXdvcmtmbG93LmFzbC5qc29uJylcbiAgICApO1xuXG4gICAgY29uc3QgbG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnSW1hZ2VQcm9jZXNzaW5nV29ya2Zsb3dMb2dzJywge1xuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZXG4gICAgfSk7XG5cbiAgICBjb25zdCBiZWRyb2NrTW9kZWxBcm4gPSBgYXJuOmF3czpiZWRyb2NrOnVzLWVhc3QtMTo6Zm91bmRhdGlvbi1tb2RlbC8ke3Byb3BzLmNvbmZpZy5iZWRyb2NrTW9kZWxJZH1gO1xuXG4gICAgY29uc3Qgc3RhdGVNYWNoaW5lID0gbmV3IHN0ZXBmdW5jdGlvbnMuU3RhdGVNYWNoaW5lKHRoaXMsICdJbWFnZVByb2Nlc3NpbmdXb3JrZmxvdycsIHtcbiAgICAgIHN0YXRlTWFjaGluZU5hbWU6IHByb3BzLmNvbmZpZy5pbWFnZVByb2Nlc3NpbmdXb3JrZmxvd05hbWUsXG4gICAgICBkZWZpbml0aW9uQm9keSxcbiAgICAgIGRlZmluaXRpb25TdWJzdGl0dXRpb25zOiB7XG4gICAgICAgIE1heENvbmN1cnJlbmN5OiBwcm9wcy5jb25maWcubWF4Q29uY3VycmVuY3kudG9TdHJpbmcoKSxcbiAgICAgICAgQnVpbGRCZWRyb2NrUmVxdWVzdEZ1bmN0aW9uQXJuOiBwcm9wcy5jb21wdXRlRnVuY3Rpb25zLmJ1aWxkUmVxdWVzdEZ1bmN0aW9uLmZ1bmN0aW9uQXJuLFxuICAgICAgICBQYXJzZUJlZHJvY2tSZXNwb25zZUZ1bmN0aW9uQXJuOiBwcm9wcy5jb21wdXRlRnVuY3Rpb25zLnBhcnNlUmVzcG9uc2VGdW5jdGlvbi5mdW5jdGlvbkFybixcbiAgICAgICAgR2VuZXJhdGVTdGF0dXNSZXBvcnRGdW5jdGlvbkFybjogcHJvcHMuY29tcHV0ZUZ1bmN0aW9ucy5zdGF0dXNSZXBvcnRGdW5jdGlvbi5mdW5jdGlvbkFybixcbiAgICAgICAgU3RhdHVzVGFibGVOYW1lOiBwcm9wcy5zdGF0dXNUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIE5vdGlmaWNhdGlvblNOU1RvcGljQXJuOiBwcm9wcy5zbnNUb3BpYy50b3BpY0FybixcbiAgICAgICAgQmVkcm9ja01vZGVsQXJuOiBiZWRyb2NrTW9kZWxBcm5cbiAgICAgIH0sXG4gICAgICB0cmFjaW5nRW5hYmxlZDogdHJ1ZSxcbiAgICAgIGxvZ3M6IHtcbiAgICAgICAgZGVzdGluYXRpb246IGxvZ0dyb3VwLFxuICAgICAgICBsZXZlbDogc3RlcGZ1bmN0aW9ucy5Mb2dMZXZlbC5BTEwsXG4gICAgICAgIGluY2x1ZGVFeGVjdXRpb25EYXRhOiB0cnVlXG4gICAgICB9LFxuICAgICAgdGltZW91dDogRHVyYXRpb24ubWludXRlcygxNSlcbiAgICB9KTtcblxuICAgIHN0YXRlTWFjaGluZS5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydiZWRyb2NrOkludm9rZU1vZGVsJ10sXG4gICAgICByZXNvdXJjZXM6IFtiZWRyb2NrTW9kZWxBcm5dXG4gICAgfSkpO1xuXG4gICAgc3RhdGVNYWNoaW5lLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ2xhbWJkYTpJbnZva2VGdW5jdGlvbiddLFxuICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgIHByb3BzLmNvbXB1dGVGdW5jdGlvbnMuYnVpbGRSZXF1ZXN0RnVuY3Rpb24uZnVuY3Rpb25Bcm4sXG4gICAgICAgIGAke3Byb3BzLmNvbXB1dGVGdW5jdGlvbnMuYnVpbGRSZXF1ZXN0RnVuY3Rpb24uZnVuY3Rpb25Bcm59OipgLFxuICAgICAgICBwcm9wcy5jb21wdXRlRnVuY3Rpb25zLnBhcnNlUmVzcG9uc2VGdW5jdGlvbi5mdW5jdGlvbkFybixcbiAgICAgICAgYCR7cHJvcHMuY29tcHV0ZUZ1bmN0aW9ucy5wYXJzZVJlc3BvbnNlRnVuY3Rpb24uZnVuY3Rpb25Bcm59OipgLFxuICAgICAgICBwcm9wcy5jb21wdXRlRnVuY3Rpb25zLnN0YXR1c1JlcG9ydEZ1bmN0aW9uLmZ1bmN0aW9uQXJuLFxuICAgICAgICBgJHtwcm9wcy5jb21wdXRlRnVuY3Rpb25zLnN0YXR1c1JlcG9ydEZ1bmN0aW9uLmZ1bmN0aW9uQXJufToqYFxuICAgICAgXVxuICAgIH0pKTtcblxuICAgIHN0YXRlTWFjaGluZS5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydkeW5hbW9kYjpQdXRJdGVtJ10sXG4gICAgICByZXNvdXJjZXM6IFtwcm9wcy5zdGF0dXNUYWJsZS50YWJsZUFybl1cbiAgICB9KSk7XG5cbiAgICBzdGF0ZU1hY2hpbmUuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnc25zOlB1Ymxpc2gnXSxcbiAgICAgIHJlc291cmNlczogW3Byb3BzLnNuc1RvcGljLnRvcGljQXJuXVxuICAgIH0pKTtcblxuICAgIHN0YXRlTWFjaGluZS5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydzMzpHZXRPYmplY3QnLCAnczM6UHV0T2JqZWN0JywgJ3MzOkFib3J0TXVsdGlwYXJ0VXBsb2FkJywgJ3MzOkxpc3RNdWx0aXBhcnRVcGxvYWRQYXJ0cyddLFxuICAgICAgcmVzb3VyY2VzOiBbcHJvcHMuYnVja2V0LmFybkZvck9iamVjdHMoJyonKV1cbiAgICB9KSk7XG5cbiAgICBzdGF0ZU1hY2hpbmUuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ3hyYXk6UHV0VHJhY2VTZWdtZW50cycsXG4gICAgICAgICd4cmF5OlB1dFRlbGVtZXRyeVJlY29yZHMnLFxuICAgICAgICAneHJheTpHZXRTYW1wbGluZ1J1bGVzJyxcbiAgICAgICAgJ3hyYXk6R2V0U2FtcGxpbmdUYXJnZXRzJ1xuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogWycqJ11cbiAgICB9KSk7XG5cbiAgICBwcm9wcy5jb21wdXRlRnVuY3Rpb25zLnN0YXJ0V29ya2Zsb3dGdW5jdGlvbi5hZGRFbnZpcm9ubWVudChcbiAgICAgICdTVEFURV9NQUNISU5FX0lNQUdFX1BST0NFU1NJTkdfQVJOJyxcbiAgICAgIHN0YXRlTWFjaGluZS5zdGF0ZU1hY2hpbmVBcm5cbiAgICApO1xuICAgIHN0YXRlTWFjaGluZS5ncmFudFN0YXJ0RXhlY3V0aW9uKHByb3BzLmNvbXB1dGVGdW5jdGlvbnMuc3RhcnRXb3JrZmxvd0Z1bmN0aW9uKTtcblxuICAgIGFwcGx5Q2RrTmFnKHRoaXMpO1xuICAgIFNlY3VyaXR5U3VwcHJlc3Npb25zLmFwcGx5Q29tbW9uU3VwcHJlc3Npb25zKHRoaXMsICdPcmNoZXN0cmF0aW9uIFN0YWNrJyk7XG4gICAgU2VjdXJpdHlTdXBwcmVzc2lvbnMuYXBwbHlTdGVwRnVuY3Rpb25zU3VwcHJlc3Npb25zKHRoaXMpO1xuXG4gICAgdGhpcy5vdXRwdXRzID0ge1xuICAgICAgc3RhdGVNYWNoaW5lXG4gICAgfTtcbiAgfVxufVxuIl19