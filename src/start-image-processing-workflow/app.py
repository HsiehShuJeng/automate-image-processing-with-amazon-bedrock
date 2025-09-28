#!/usr/bin/env python3
"""Lambda entry point for starting the image processing workflow."""

from __future__ import annotations

import json
import os
from typing import Any, Dict

import boto3
from aws_lambda_powertools.metrics import MetricUnit
from image_processing_common.observability import (
    correlation_paths,
    logger,
    metrics,
    tracer,
)

# Initialize AWS clients
step_function = boto3.client("stepfunctions")

# Environment variables
STATE_MACHINE_IMAGE_PROCESSING_ARN = os.environ.get('STATE_MACHINE_IMAGE_PROCESSING_ARN')
INPUT_BUCKET = os.environ.get('INPUT_BUCKET')
IMAGE_PREFIX = os.environ.get('IMAGE_PREFIX')
GENERATED_IMAGE_PREFIX = os.environ.get('GENERATED_IMAGE_PREFIX')
STATUS_REPORT_PREFIX = os.environ.get('STATUS_REPORT_PREFIX')

metrics.set_default_dimensions(service="image-processing-workflow")


def _extract_first_record(event: Dict[str, Any]) -> Dict[str, Any]:
    """Return the first DynamoDB change record from the stream event."""

    records = event.get('Records', [])
    if not records:
        raise ValueError('No DynamoDB stream records found in event payload')

    dynamodb_payload = records[0].get('dynamodb')
    if not dynamodb_payload:
        raise ValueError('Missing DynamoDB payload in stream record')

    return dynamodb_payload


def _set_correlation_context(event: Dict[str, Any]) -> None:
    """Attach correlation identifiers for structured logging and tracing."""

    correlation_id = event.get('Records', [{}])[0].get('eventID')
    if correlation_id:
        logger.set_correlation_id(correlation_id)
        logger.append_keys(correlation_id=correlation_id)
        tracer.put_annotation('CorrelationId', correlation_id)


@logger.inject_lambda_context(correlation_id_path=correlation_paths.DYNAMODB_STREAM)
@tracer.capture_lambda_handler
@metrics.log_metrics(capture_cold_start_metric=True)
def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Start the Step Functions workflow based on DynamoDB stream events."""

    _set_correlation_context(event)

    try:
        dynamodb_item = _extract_first_record(event)
        record = build_workflow_input(dynamodb_item)

        tracer.put_annotation('WorkflowId', record['Id'])
        tracer.put_metadata(key='WorkflowInput', value=record)

        response = start_step_function_execution(record)

        metrics.add_metric(name='WorkflowsStarted', unit=MetricUnit.Count, value=1)
        logger.info('Successfully started image processing workflow', extra={
            'executionArn': response.get('executionArn'),
            'workflowId': record['Id']
        })

        return {
            'statusCode': 200,
            'executionArn': response.get('executionArn')
        }

    except Exception as error:
        metrics.add_metric(name='WorkflowStartFailures', unit=MetricUnit.Count, value=1)
        logger.error('Failed to start image processing workflow', extra={'error': str(error)}, exc_info=True)
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
