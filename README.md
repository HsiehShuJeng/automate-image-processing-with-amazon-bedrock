# automate-image-processing-with-amazon-bedrock
CDK application for automating large-scale image background replacement using Amazon Bedrock, Step Functions, and Titan Image Generator G1.

## Deployment Region Information

### Primary Deployment Region: Tokyo (ap-northeast-1)
All AWS services will be deployed in the Asia Pacific (Tokyo) region for optimal performance and service availability:

**Available Services in ap-northeast-1:**
- ✅ Amazon S3
- ✅ Amazon DynamoDB  
- ✅ AWS Lambda
- ✅ Amazon API Gateway
- ✅ AWS Step Functions
- ✅ Amazon SNS
- ✅ Amazon Cognito User Pools
- ✅ Amazon Rekognition

### Cross-Region Service: Amazon Bedrock
- **Bedrock Region**: US East (N. Virginia) - us-east-1
- **Model**: Amazon Titan Image Generator G1 (amazon.titan-image-generator-v1)
- **Reason**: Bedrock Titan Image Generator is primarily available in us-east-1
- **Impact**: Acceptable cross-region latency for image processing workflow

### Architecture Benefits
- **Low Latency**: All primary services in Tokyo region for optimal performance
- **Service Availability**: Full service coverage in ap-northeast-1
- **Cross-Region Optimization**: Only Bedrock calls cross-region, minimizing latency impact
- **Compliance**: Data residency in Asia Pacific region while leveraging US-based AI services
