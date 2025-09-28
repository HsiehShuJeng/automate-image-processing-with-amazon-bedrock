#!/usr/bin/env python3
"""
Lambda function to build Bedrock InvokeModel requests for image processing.

This function constructs Bedrock API requests with image data and prompts
for AI-powered image generation and processing.
"""

import base64
import io
import json
import os
from random import randint
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
s3_client = boto3.client('s3')

metrics.set_default_dimensions(service="build-bedrock-request")


@logger.inject_lambda_context(correlation_id_path=correlation_paths.API_GATEWAY_REST)
@tracer.capture_lambda_handler
@metrics.log_metrics(capture_cold_start_metric=True)
def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for building Bedrock InvokeModel requests.

    Args:
        event: Step Functions event containing image processing parameters
        context: Lambda context object

    Returns:
        Dictionary containing Bedrock request payload
    """
    try:
        logger.info("Starting Bedrock request construction", extra={"event": event})
        
        # Extract request payload
        request_data = extract_request_data(event)
        
        # Download and process image
        image_data = download_and_encode_image(
            request_data['s3_bucket'],
            request_data['input_s3_prefix'],
            request_data['image_file_name']
        )
        
        # Build Bedrock request
        bedrock_request = build_bedrock_request_payload(
            image_data,
            request_data['prompt'],
            request_data['negative_prompt'],
            request_data['mode']
        )
        
        # Store request payload in S3
        store_request_payload(
            request_data['s3_bucket'],
            request_data['s3_output_key'],
            bedrock_request
        )
        
        logger.info("Successfully built Bedrock request")
        metrics.add_metric(name="BedrockRequestsBuilt", unit=MetricUnit.Count, value=1)
        
        return {
            'statusCode': 200,
            'S3Bucket': request_data['s3_bucket'],
            'S3Key': request_data['s3_output_key'],
            'BedrockRequest': bedrock_request
        }
        
    except Exception as e:
        logger.error(f"Failed to build Bedrock request: {e}", exc_info=True)
        metrics.add_metric(name="BedrockRequestErrors", unit=MetricUnit.Count, value=1)
        raise


@tracer.capture_method
def extract_request_data(event: Dict[str, Any]) -> Dict[str, str]:
    """
    Extract and validate request data from event.

    Args:
        event: Step Functions event

    Returns:
        Dictionary containing extracted request parameters
    """
    required_fields = ['S3Bucket', 'InputS3Prefix', 'Prompt', 'NegativePrompt', 'Mode']
    for field in required_fields:
        if field not in event:
            raise ValueError(f"Missing required field: {field}")
    
    if 'Image' not in event or 'ImageName' not in event['Image']:
        raise ValueError("Missing Image.ImageName in event")
    
    image_file_name = event['Image']['ImageName']
    image_file_name_without_extension = image_file_name.split('.')[0]
    
    return {
        's3_bucket': event['S3Bucket'],
        'input_s3_prefix': event['InputS3Prefix'],
        'prompt': event['Prompt'],
        'negative_prompt': event['NegativePrompt'],
        'mode': event['Mode'],
        'image_file_name': image_file_name,
        'image_labels': event['Image'].get('Labels', ''),
        's3_output_key': f"{event['InputS3Prefix']}/{image_file_name_without_extension}.json"
    }


@tracer.capture_method
def download_and_encode_image(s3_bucket: str, s3_prefix: str, image_file_name: str) -> str:
    """
    Download image from S3 and encode as base64.

    Args:
        s3_bucket: S3 bucket name
        s3_prefix: S3 key prefix
        image_file_name: Image file name

    Returns:
        Base64 encoded image data
    """
    s3_key = f"{s3_prefix}/{image_file_name}"
    tmp_image_path = f'/tmp/{image_file_name}'
    
    try:
        logger.info(f"Downloading image from s3://{s3_bucket}/{s3_key}")
        s3_client.download_file(s3_bucket, s3_key, tmp_image_path)
        
        with open(tmp_image_path, 'rb') as image_file:
            image_data = base64.b64encode(image_file.read()).decode('utf-8')
        
        logger.info(f"Successfully encoded image: {len(image_data)} bytes")
        return image_data
        
    except Exception as e:
        logger.error(f"Failed to download/encode image: {e}")
        raise
    finally:
        # Clean up temporary file
        if os.path.exists(tmp_image_path):
            os.remove(tmp_image_path)


@tracer.capture_method
def build_bedrock_request_payload(
    image_data: str,
    prompt: str,
    negative_prompt: str,
    mode: str
) -> Dict[str, Any]:
    """
    Build Bedrock InvokeModel request payload.

    Args:
        image_data: Base64 encoded image data
        prompt: Generation prompt
        negative_prompt: Negative prompt
        mode: Processing mode

    Returns:
        Bedrock request payload dictionary
    """
    # Build request based on mode and image data
    request_payload = {
        "taskType": "IMAGE_VARIATION" if mode == "variation" else "TEXT_IMAGE",
        "imageVariationParams": {
            "text": prompt,
            "negativeText": negative_prompt,
            "images": [image_data]
        } if mode == "variation" else None,
        "textToImageParams": {
            "text": prompt,
            "negativeText": negative_prompt
        } if mode != "variation" else None
    }
    
    # Remove None values
    request_payload = {k: v for k, v in request_payload.items() if v is not None}
    
    logger.info(f"Built Bedrock request for mode: {mode}")
    return request_payload


@tracer.capture_method
def store_request_payload(s3_bucket: str, s3_key: str, payload: Dict[str, Any]) -> None:
    """
    Store Bedrock request payload in S3.

    Args:
        s3_bucket: S3 bucket name
        s3_key: S3 key for storage
        payload: Request payload to store
    """
    try:
        s3_client.put_object(
            Bucket=s3_bucket,
            Key=s3_key,
            Body=json.dumps(payload),
            ContentType='application/json'
        )
        logger.info(f"Stored request payload at s3://{s3_bucket}/{s3_key}")
        
    except Exception as e:
        logger.error(f"Failed to store request payload: {e}")
        raise
