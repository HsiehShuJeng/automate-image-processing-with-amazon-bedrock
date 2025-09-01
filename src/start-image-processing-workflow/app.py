#!/usr/bin/env python3
"""
Lambda function to start image processing workflow from DynamoDB stream events.

This function is triggered by DynamoDB stream events and starts a Step Functions
state machine execution for image processing workflows.
"""

import boto3
import json
import logging
import os
from typing import Any, Dict

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize AWS clients
step_function = boto3.client("stepfunctions")

# Environment variables
STATE_MACHINE_IMAGE_PROCESSING_ARN = os.environ.get('STATE_MACHINE_IMAGE_PROCESSING_ARN')
INPUT_BUCKET = os.environ.get('INPUT_BUCKET')
IMAGE_PREFIX = os.environ.get('IMAGE_PREFIX')
GENERATED_IMAGE_PREFIX = os.environ.get('GENERATED_IMAGE_PREFIX')
STATUS_REPORT_PREFIX = os.environ.get('STATUS_REPORT_PREFIX')


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for starting image processing workflow.

    Args:
        event: DynamoDB stream event containing record changes
        context: Lambda context object

    Returns:
        Dictionary containing execution status and details
    """
    try:
        logger.info('Starting image processing workflow')
        
        dynamodb_item = event['Records'][0]['dynamodb']
        
        record = build_workflow_input(dynamodb_item)
        
        # Start Step Functions execution
        response = start_step_function_execution(record)
        
        logger.info(f"Started workflow execution: {response.get('executionArn')}")
        
        return {
            'statusCode': 200,
            'executionArn': response.get('executionArn')
        }
        
    except Exception as e:
        logger.error(f"Failed to start image processing workflow: {e}")
        raise


def build_workflow_input(dynamodb_item: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build workflow input from DynamoDB stream record.

    Args:
        dynamodb_item: DynamoDB stream record item

    Returns:
        Dictionary containing workflow input parameters
    """
    record = {}
    
    record['Id'] = dynamodb_item['NewImage']['Id']['S']
    image_s3_prefix = dynamodb_item['NewImage']['ImageS3Prefix']['S']
    record['S3Bucket'] = INPUT_BUCKET
    record['InputS3Prefix'] = f'{IMAGE_PREFIX}{image_s3_prefix}'
    record['OutputS3Prefix'] = f'{GENERATED_IMAGE_PREFIX}{image_s3_prefix}'
    record['StatusS3Prefix'] = f'{STATUS_REPORT_PREFIX}{image_s3_prefix}'
    record['Prompt'] = dynamodb_item['NewImage']['Prompt']['S']
    record['NegativePrompt'] = dynamodb_item['NewImage']['NegativePrompt']['S']
    record['Mode'] = dynamodb_item['NewImage']['Mode']['S']
    
    # Process images array
    images = []
    for image in dynamodb_item['NewImage']['Images']['L']:
        images.append({
            'ImageName': image['M']['ImageName']['S'],
            'Labels': image['M']['Labels']['S']
        })
    
    record['Images'] = images
    
    return record


def start_step_function_execution(record: Dict[str, Any]) -> Dict[str, Any]:
    """
    Start Step Functions state machine execution.

    Args:
        record: Workflow input parameters

    Returns:
        Step Functions execution response
    """
    if not STATE_MACHINE_IMAGE_PROCESSING_ARN:
        raise ValueError("STATE_MACHINE_IMAGE_PROCESSING_ARN environment variable not set")
    
    response = step_function.start_execution(
        stateMachineArn=STATE_MACHINE_IMAGE_PROCESSING_ARN,
        input=json.dumps(record)
    )
    
    return response
