#!/usr/bin/env python3
"""
Lambda function to generate status reports for image processing workflows.

This function creates comprehensive status reports and stores them in S3
with pre-signed URLs for easy access.
"""

import json
import logging
import os
from datetime import datetime, timedelta
from typing import Any, Dict, List

import boto3
from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.logging import correlation_paths
from aws_lambda_powertools.metrics import Metrics, MetricUnit

# Initialize AWS Lambda Powertools
logger = Logger()
tracer = Tracer()
metrics = Metrics()

# Initialize AWS clients
s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

# Environment variables
STATUS_TABLE = os.environ.get('STATUS_TABLE')
STATUS_REPORT_URL_EXPIRATION = int(os.environ.get('STATUS_REPORT_URL_EXPIRATION', '86400'))


@logger.inject_lambda_context(correlation_id_path=correlation_paths.API_GATEWAY_REST)
@tracer.capture_lambda_handler
@metrics.log_metrics(capture_cold_start_metric=True)
def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for generating status reports.

    Args:
        event: Step Functions event containing processing results
        context: Lambda context object

    Returns:
        Dictionary containing status report information
    """
    try:
        logger.info("Starting status report generation", extra={"event": event})
        
        # Extract processing data
        processing_data = extract_processing_data(event)
        
        # Generate status report
        status_report = generate_status_report(processing_data)
        
        # Store report in S3
        report_s3_key = store_status_report(
            processing_data['s3_bucket'],
            processing_data['status_s3_prefix'],
            processing_data['workflow_id'],
            status_report
        )
        
        # Generate pre-signed URL
        presigned_url = generate_presigned_url(
            processing_data['s3_bucket'],
            report_s3_key
        )
        
        # Update status in DynamoDB
        update_status_table(processing_data['workflow_id'], {
            'status': 'COMPLETED',
            'report_url': presigned_url,
            'completed_at': datetime.utcnow().isoformat(),
            'processed_images': len(processing_data.get('processed_images', []))
        })
        
        logger.info("Successfully generated status report")
        metrics.add_metric(name="StatusReportsGenerated", unit=MetricUnit.Count, value=1)
        
        return {
            'statusCode': 200,
            'ReportS3Key': report_s3_key,
            'ReportURL': presigned_url,
            'WorkflowId': processing_data['workflow_id']
        }
        
    except Exception as e:
        logger.error(f"Failed to generate status report: {e}", exc_info=True)
        metrics.add_metric(name="StatusReportErrors", unit=MetricUnit.Count, value=1)
        raise


@tracer.capture_method
def extract_processing_data(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract processing data from event.

    Args:
        event: Step Functions event

    Returns:
        Dictionary containing processing information
    """
    required_fields = ['S3Bucket', 'StatusS3Prefix']
    for field in required_fields:
        if field not in event:
            raise ValueError(f"Missing required field: {field}")
    
    return {
        's3_bucket': event['S3Bucket'],
        'status_s3_prefix': event['StatusS3Prefix'],
        'workflow_id': event.get('Id', 'unknown'),
        'prompt': event.get('Prompt', ''),
        'negative_prompt': event.get('NegativePrompt', ''),
        'mode': event.get('Mode', ''),
        'processed_images': event.get('ProcessedImages', []),
        'input_images': event.get('Images', [])
    }


@tracer.capture_method
def generate_status_report(processing_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate comprehensive status report.

    Args:
        processing_data: Processing information

    Returns:
        Status report dictionary
    """
    report = {
        'workflow_id': processing_data['workflow_id'],
        'timestamp': datetime.utcnow().isoformat(),
        'status': 'COMPLETED',
        'processing_summary': {
            'prompt': processing_data['prompt'],
            'negative_prompt': processing_data['negative_prompt'],
            'mode': processing_data['mode'],
            'input_images_count': len(processing_data['input_images']),
            'processed_images_count': len(processing_data['processed_images'])
        },
        'input_images': processing_data['input_images'],
        'processed_images': processing_data['processed_images'],
        'processing_details': {
            'started_at': processing_data.get('started_at'),
            'completed_at': datetime.utcnow().isoformat(),
            'duration_seconds': calculate_processing_duration(processing_data)
        }
    }
    
    logger.info(f"Generated status report for workflow: {processing_data['workflow_id']}")
    return report


@tracer.capture_method
def calculate_processing_duration(processing_data: Dict[str, Any]) -> float:
    """
    Calculate processing duration in seconds.

    Args:
        processing_data: Processing information

    Returns:
        Duration in seconds
    """
    try:
        if 'started_at' in processing_data:
            started = datetime.fromisoformat(processing_data['started_at'].replace('Z', '+00:00'))
            completed = datetime.utcnow()
            return (completed - started).total_seconds()
    except Exception as e:
        logger.warning(f"Could not calculate duration: {e}")
    
    return 0.0


@tracer.capture_method
def store_status_report(
    s3_bucket: str,
    status_prefix: str,
    workflow_id: str,
    report: Dict[str, Any]
) -> str:
    """
    Store status report in S3.

    Args:
        s3_bucket: S3 bucket name
        status_prefix: S3 prefix for status reports
        workflow_id: Workflow identifier
        report: Status report data

    Returns:
        S3 key of stored report
    """
    timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    report_key = f"{status_prefix}/status_report_{workflow_id}_{timestamp}.json"
    
    try:
        s3_client.put_object(
            Bucket=s3_bucket,
            Key=report_key,
            Body=json.dumps(report, indent=2),
            ContentType='application/json'
        )
        
        logger.info(f"Stored status report at s3://{s3_bucket}/{report_key}")
        return report_key
        
    except Exception as e:
        logger.error(f"Failed to store status report: {e}")
        raise


@tracer.capture_method
def generate_presigned_url(s3_bucket: str, s3_key: str) -> str:
    """
    Generate pre-signed URL for status report access.

    Args:
        s3_bucket: S3 bucket name
        s3_key: S3 key of the report

    Returns:
        Pre-signed URL string
    """
    try:
        presigned_url = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': s3_bucket, 'Key': s3_key},
            ExpiresIn=STATUS_REPORT_URL_EXPIRATION
        )
        
        logger.info(f"Generated pre-signed URL for {s3_key}")
        return presigned_url
        
    except Exception as e:
        logger.error(f"Failed to generate pre-signed URL: {e}")
        raise


@tracer.capture_method
def update_status_table(workflow_id: str, status_data: Dict[str, Any]) -> None:
    """
    Update status information in DynamoDB.

    Args:
        workflow_id: Workflow identifier
        status_data: Status information to update
    """
    if not STATUS_TABLE:
        logger.warning("STATUS_TABLE environment variable not set, skipping DynamoDB update")
        return
    
    try:
        table = dynamodb.Table(STATUS_TABLE)
        
        # Build update expression
        update_expression = "SET "
        expression_values = {}
        
        for key, value in status_data.items():
            update_expression += f"#{key} = :{key}, "
            expression_values[f":{key}"] = value
        
        update_expression = update_expression.rstrip(', ')
        expression_names = {f"#{key}": key for key in status_data.keys()}
        
        table.update_item(
            Key={'Id': workflow_id},
            UpdateExpression=update_expression,
            ExpressionAttributeNames=expression_names,
            ExpressionAttributeValues=expression_values
        )
        
        logger.info(f"Updated status table for workflow: {workflow_id}")
        
    except Exception as e:
        logger.error(f"Failed to update status table: {e}")
        # Don't raise - status table update is not critical
