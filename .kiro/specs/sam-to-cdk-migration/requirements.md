# SAM to CDK Migration Requirements

## Project Overview
Migrate the existing SAM-based image processing application to AWS CDK TypeScript. The application automates background changes in images using Amazon Bedrock and Step Functions.

## Architecture Components to Migrate

### 1. Storage Layer
- **S3 Bucket**: Image storage with public access blocked
- **DynamoDB Tables**:
  - `ImagesTable`: Stores image metadata and processing requests
  - `StatusTable`: Tracks processing status for each image

### 2. Authentication & Authorization
- **Cognito User Pool**: User authentication
- **Cognito User Pool Client**: Application client with secret
- **API Gateway Authorizer**: Cognito-based authorization

### 3. API Layer
- **API Gateway REST API** with endpoints:
  - `/detectLabels` (POST): Amazon Rekognition integration
  - `/images` (POST): DynamoDB integration for image metadata
- **IAM Roles**: API Gateway service roles for DynamoDB and Rekognition

### 4. Compute Layer
- **Lambda Functions**:
  - `StartImageProcessingWorkflowFunction`: DynamoDB stream trigger
  - `BuildBedrockRequestFunction`: Constructs Bedrock requests
  - `ParseBedrockResponseFunction`: Processes Bedrock responses
  - `GenerateStatusReportFunction`: Creates processing reports

### 5. Orchestration Layer
- **Step Functions State Machine**: `ImageProcessingWorkflow`
  - Distributed map processing with max concurrency
  - Bedrock InvokeModel integration
  - DynamoDB status updates
  - Error handling and retry logic

### 6. Notification Layer
- **SNS Topic**: Email notifications for completion
- **SNS Subscription**: Email endpoint

## CDK Implementation Requirements

### 1. Project Structure
```
lib/
├── constructs/
│   ├── storage-stack.ts
│   ├── auth-stack.ts
│   ├── api-stack.ts
│   ├── compute-stack.ts
│   ├── orchestration-stack.ts
│   └── notification-stack.ts
├── image-processing-stack.ts
└── app.ts
bin/
└── image-processing-app.ts
```

### 2. Configuration Parameters
- API name, S3 bucket name, prefixes
- Bedrock model ID, max concurrency
- SNS topic name, notification email
- Status report URL expiration

### 3. Lambda Functions Migration
- Convert Python 3.13 Lambda functions to CDK constructs
- Maintain existing source code structure
- Configure memory, timeout, and environment variables
- Set up proper IAM permissions

### 4. Step Functions Definition
- Convert YAML state machine to CDK StateMachine construct
- Implement distributed map processing
- Configure Bedrock integration
- Set up DynamoDB integrations
- Implement error handling and retry policies

### 5. IAM Permissions
- Step Functions execution role with Bedrock, Lambda, S3, SNS, DynamoDB permissions
- Lambda execution roles with appropriate service permissions
- API Gateway service roles for DynamoDB and Rekognition

### 6. Outputs
- S3 bucket name and prefixes
- Cognito User Pool ID and Client details  
- Cognito User Pool Client Secret
- API Gateway endpoint URL

### 7. Lambda Configuration Details
- **StartWorkflowFunction**: 128MB memory, 120s timeout
- **BuildBedrockRequestFunction**: 512MB memory, 1024MB ephemeral storage, 900s timeout
- **ParseBedrockResponseFunction**: 512MB memory, 1024MB ephemeral storage, 900s timeout  
- **GenerateStatusReportFunction**: 128MB memory, 900s timeout

### 8. DynamoDB Schema Corrections
- **StatusTable**: Composite key (Id as HASH, ImageName as RANGE)
- **ImagesTable**: Stream with NEW_IMAGE view type
- **Stream Configuration**: BatchSize=1, StartingPosition=LATEST

### 9. API Gateway Direct Integrations
- **DetectLabels**: Direct Rekognition integration with specific headers
- **Images**: Direct DynamoDB integration with VTL templates
- **Deployment Strategy**: Separate deployments with method dependencies

### 10. Environment Variables Mapping
- STATE_MACHINE_IMAGE_PROCESSING_ARN, INPUT_BUCKET, IMAGE_PREFIX
- GENERATED_IMAGE_PREFIX, STATUS_REPORT_PREFIX
- STATUS_TABLE, STATUS_REPORT_URL_EXPIRATION

### 11. Cognito Configuration Specifics
- Password policy with complexity requirements
- Email verification, admin-only user creation
- Client secret generation enabled

## Migration Considerations

### 1. Resource Naming
- Use consistent naming conventions
- Maintain compatibility with existing UI configuration
- Ensure unique resource names across deployments

### 2. Security
- Implement least privilege IAM policies
- Enable encryption for DynamoDB and S3
- Configure proper CORS for API Gateway

### 3. Monitoring & Observability
- Enable X-Ray tracing for Step Functions
- Configure CloudWatch logging for Lambda functions
- Set up appropriate log retention policies

### 4. Cost Optimization
- Use PAY_PER_REQUEST billing for DynamoDB
- Configure appropriate Lambda memory and timeout settings
- Implement S3 lifecycle policies if needed

### 5. Testing & Validation
- Ensure compatibility with existing Streamlit UI
- Validate all API endpoints and integrations
- Test Step Functions workflow with sample data

## Dependencies
- AWS CDK v2
- TypeScript
- Node.js runtime for CDK
- Python 3.13 runtime for Lambda functions

## Deployment Strategy
1. Create new CDK application
2. Implement constructs incrementally
3. Test each component independently
4. Perform end-to-end testing
5. Update UI configuration
6. Deploy to production environment

## Target Deployment Region
- **Primary Region**: Asia Pacific (Tokyo) - ap-northeast-1
- **Cross-Region Service**: Amazon Bedrock in US East (N. Virginia) - us-east-1
- **Rationale**: Full service availability in Tokyo with acceptable cross-region latency for Bedrock calls
