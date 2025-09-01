#!/usr/bin/env node

/**
 * API Stack for the Image Processing application.
 * Contains API Gateway REST API with direct service integrations.
 */

import { Stack } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { ApiStackProps, ApiStackOutputs } from '../types';
import { applyCdkNag, SecuritySuppressions } from '../utils';

export class ApiStack extends Stack {
  public readonly outputs: ApiStackOutputs;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // Create REST API
    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: props.config.apiName,
      description: 'Image Processing API with direct service integrations',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key']
      }
    });

    // Create Cognito authorizer
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [props.userPool],
      authorizerName: 'CognitoUserPoolsAuthorizer'
    });

    // Create IAM role for Rekognition integration
    const rekognitionRole = new iam.Role(this, 'APIGatewayRekognitionRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      inlinePolicies: {
        RekognitionPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['rekognition:DetectLabels'],
              resources: ['*']
            })
          ]
        })
      }
    });

    // Create IAM role for DynamoDB integration
    const dynamoDbRole = new iam.Role(this, 'APIGatewayDynamoDBRole', {
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      inlinePolicies: {
        DynamoDBPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['dynamodb:PutItem'],
              resources: [props.imagesTable.tableArn]
            })
          ]
        })
      }
    });

    // Create /detectLabels resource and method
    const detectLabelsResource = api.root.addResource('detectLabels');
    detectLabelsResource.addMethod('POST', 
      new apigateway.AwsIntegration({
        service: 'rekognition',
        action: 'DetectLabels',
        options: {
          credentialsRole: rekognitionRole,
          requestParameters: {
            'integration.request.header.Content-Type': "'application/x-amz-json-1.1'",
            'integration.request.header.X-Amz-Target': "'RekognitionService.DetectLabels'"
          },
          integrationResponses: [{
            statusCode: '200'
          }]
        }
      }), {
        authorizer,
        methodResponses: [{
          statusCode: '200'
        }]
      }
    );

    // Create /images resource and method with DynamoDB integration and VTL template
    const imagesResource = api.root.addResource('images');
    const vtlTemplate = `#set($inputRoot = $input.path('$'))
{
  "TableName": "ImagesTable",
  "Item": {
    "Id": { "S": "$inputRoot.Id" },
    "ImageS3Prefix": { "S": "$inputRoot.ImageS3Prefix" },
    "Prompt": { "S": "$inputRoot.Prompt" },
    "NegativePrompt": { "S": "$inputRoot.NegativePrompt" },
    "Mode": { "S": "$inputRoot.Mode" },
    "Images": {
      "L": [
        #foreach($image in $inputRoot.Images)
        {
          "M": {
            "ImageName": { "S": "$image.ImageName" },
            "Labels": { "S": "$image.Labels" }
          }
        }#if($foreach.hasNext),#end
        #end
      ]
    }
  }
}`;

    imagesResource.addMethod('POST',
      new apigateway.AwsIntegration({
        service: 'dynamodb',
        action: 'PutItem',
        options: {
          credentialsRole: dynamoDbRole,
          requestParameters: {
            'integration.request.header.Content-Type': "'application/x-amz-json-1.1'",
            'integration.request.header.X-Amz-Target': "'DynamoDB_20120810.PutItem'"
          },
          requestTemplates: {
            'application/json': vtlTemplate
          },
          passthroughBehavior: apigateway.PassthroughBehavior.WHEN_NO_TEMPLATES,
          integrationResponses: [{
            statusCode: '200'
          }]
        }
      }), {
        authorizer,
        methodResponses: [{
          statusCode: '200'
        }]
      }
    );

    // Apply CDK Nag security checks
    applyCdkNag(this);
    SecuritySuppressions.applyCommonSuppressions(this, 'API Stack');
    SecuritySuppressions.applyApiGatewaySuppressions(this);

    // Export outputs
    this.outputs = {
      api,
      apiUrl: api.url
    };
  }
}
