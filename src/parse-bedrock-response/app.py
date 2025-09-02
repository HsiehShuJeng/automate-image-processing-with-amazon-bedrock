#!/usr/bin/env python3
"""
Lambda function to parse Bedrock InvokeModel responses for image processing.

This function processes Bedrock API responses, extracts generated images,
and stores them in S3 for further processing.
"""

import base64
import io
import json
import logging
import os
from typing import Any, Dict, List

import boto3
from aws_lambda_powertools import Logger, Tracer
from aws_lambda_powertools.logging import correlation_paths
from aws_lambda_powertools.metrics import Metrics, MetricUnit
from PIL import Image, ImageDraw

# Initialize AWS Lambda Powertools
logger = Logger()
tracer = Tracer()
metrics = Metrics()

# Initialize AWS clients
s3_client = boto3.client('s3')


@logger.inject_lambda_context(correlation_id_path=correlation_paths.API_GATEWAY_REST)
@tracer.capture_lambda_handler
@metrics.log_metrics(capture_cold_start_metric=True)
def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for parsing Bedrock InvokeModel responses.

    Args:
        event: Step Functions event containing Bedrock response data
        context: Lambda context object

    Returns:
        Dictionary containing processed image information
    """
    try:
        logger.info("Starting Bedrock response parsing", extra={"event": event})
        
        # Extract response data
        response_data = extract_response_data(event)
        
        # Download and parse Bedrock response
        bedrock_response = download_bedrock_response(
            response_data['s3_bucket'],
            response_data['s3_output_key']
        )
        
        # Process generated images
        processed_images = process_generated_images(
            bedrock_response,
            response_data['s3_bucket'],
            response_data['output_s3_prefix'],
            response_data['image_file_name_without_extension']
        )
        
        logger.info(f"Successfully processed {len(processed_images)} images")
        metrics.add_metric(name="ImagesProcessed", unit=MetricUnit.Count, value=len(processed_images))
        
        return {
            'statusCode': 200,
            'ProcessedImages': processed_images,
            'S3Bucket': response_data['s3_bucket'],
            'OutputPrefix': response_data['output_s3_prefix']
        }
        
    except Exception as e:
        logger.error(f"Failed to parse Bedrock response: {e}", exc_info=True)
        metrics.add_metric(name="BedrockResponseErrors", unit=MetricUnit.Count, value=1)
        raise


@tracer.capture_method
def extract_response_data(event: Dict[str, Any]) -> Dict[str, str]:
    """
    Extract and validate response data from event.

    Args:
        event: Step Functions event

    Returns:
        Dictionary containing extracted response parameters
    """
    required_fields = ['S3Bucket', 'OutputS3Prefix']
    for field in required_fields:
        if field not in event:
            raise ValueError(f"Missing required field: {field}")
    
    if 'Image' not in event or 'ImageName' not in event['Image']:
        raise ValueError("Missing Image.ImageName in event")
    
    image_file_name = event['Image']['ImageName']
    image_file_name_without_extension = image_file_name.split('.')[0]
    
    return {
        's3_bucket': event['S3Bucket'],
        'output_s3_prefix': event['OutputS3Prefix'],
        'image_file_name': image_file_name,
        'image_file_name_without_extension': image_file_name_without_extension,
        's3_output_key': f"{event['OutputS3Prefix']}/{image_file_name_without_extension}.json"
    }


@tracer.capture_method
def download_bedrock_response(s3_bucket: str, s3_key: str) -> Dict[str, Any]:
    """
    Download Bedrock response from S3.

    Args:
        s3_bucket: S3 bucket name
        s3_key: S3 key for the response file

    Returns:
        Parsed Bedrock response dictionary
    """
    try:
        logger.info(f"Downloading Bedrock response from s3://{s3_bucket}/{s3_key}")
        
        response = s3_client.get_object(Bucket=s3_bucket, Key=s3_key)
        response_data = json.loads(response['Body'].read().decode('utf-8'))
        
        logger.info("Successfully downloaded Bedrock response")
        return response_data
        
    except Exception as e:
        logger.error(f"Failed to download Bedrock response: {e}")
        raise


@tracer.capture_method
def process_generated_images(
    bedrock_response: Dict[str, Any],
    s3_bucket: str,
    output_prefix: str,
    base_filename: str
) -> List[Dict[str, str]]:
    """
    Process generated images from Bedrock response.

    Args:
        bedrock_response: Bedrock API response
        s3_bucket: S3 bucket for output
        output_prefix: S3 prefix for output
        base_filename: Base filename for generated images

    Returns:
        List of processed image information
    """
    processed_images = []
    
    # Extract images from response (format may vary based on Bedrock model)
    images_data = bedrock_response.get('images', [])
    if not images_data and 'artifacts' in bedrock_response:
        images_data = [artifact.get('base64') for artifact in bedrock_response['artifacts'] if artifact.get('base64')]
    
    for i, image_data in enumerate(images_data):
        try:
            # Decode base64 image
            image_bytes = base64.b64decode(image_data)
            
            # Process image with PIL
            processed_image = process_single_image(image_bytes)
            
            # Generate output filename
            output_filename = f"{base_filename}_generated_{i+1}.png"
            output_key = f"{output_prefix}/{output_filename}"
            
            # Upload processed image to S3
            upload_image_to_s3(s3_bucket, output_key, processed_image)
            
            processed_images.append({
                'filename': output_filename,
                's3_key': output_key,
                'size': len(processed_image)
            })
            
            logger.info(f"Processed image {i+1}: {output_filename}")
            
        except Exception as e:
            logger.error(f"Failed to process image {i+1}: {e}")
            continue
    
    return processed_images


@tracer.capture_method
def process_single_image(image_bytes: bytes) -> bytes:
    """
    Process a single image with PIL.

    Args:
        image_bytes: Raw image bytes

    Returns:
        Processed image bytes
    """
    try:
        # Open image with PIL
        image = Image.open(io.BytesIO(image_bytes))
        
        # Convert to RGB if necessary
        if image.mode != 'RGB':
            image = image.convert('RGB')
        
        # Apply any image processing here if needed
        # For now, just return the image as PNG
        
        # Save processed image to bytes
        output_buffer = io.BytesIO()
        image.save(output_buffer, format='PNG', quality=95)
        
        return output_buffer.getvalue()
        
    except Exception as e:
        logger.error(f"Failed to process image with PIL: {e}")
        raise


@tracer.capture_method
def upload_image_to_s3(s3_bucket: str, s3_key: str, image_bytes: bytes) -> None:
    """
    Upload processed image to S3.

    Args:
        s3_bucket: S3 bucket name
        s3_key: S3 key for upload
        image_bytes: Image data to upload
    """
    try:
        s3_client.put_object(
            Bucket=s3_bucket,
            Key=s3_key,
            Body=image_bytes,
            ContentType='image/png'
        )
        logger.info(f"Uploaded image to s3://{s3_bucket}/{s3_key}")
        
    except Exception as e:
        logger.error(f"Failed to upload image to S3: {e}")
        raise
