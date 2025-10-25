# API Integration Guide

This guide documents the REST API surface exposed by the CDK deployment and highlights the compatibility considerations for the existing Streamlit UI.

## Base URL

The API is deployed as an API Gateway REST API. The URL is exported via the `ApiStack` and surfaced in deployment outputs:

- `https://<api-id>.execute-api.<region>.amazonaws.com/prod`

The Streamlit UI expects the `prod` stage unless overridden via environment configuration.

## Authentication

- **Type**: Amazon Cognito User Pool Authorizer  
- **Header**: `Authorization: Bearer <JWT>`  
- **Flow**: The UI obtains the token using the hosted UI or `USER_PASSWORD_AUTH` grant (see `docs/testing-validation.md` walkthrough).

## Endpoints

| Path | Method | Auth | Description | Integration |
| ---- | ------ | ---- | ----------- | ----------- |
| `/detectLabels` | `POST` | Cognito | Performs a synchronous Rekognition label detection call. | Direct AWS integration – `rekognition:DetectLabels`. |
| `/images` | `POST` | Cognito | Registers an image processing workflow request in DynamoDB. | Direct AWS integration – `dynamodb:PutItem`. |

### `/detectLabels` Request

```http
POST /detectLabels HTTP/1.1
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "Bucket": "image-processing-bucket-123456789012",
  "Key": "image-files/sample.png",
  "MaxLabels": 10,
  "MinConfidence": 75
}
```

**Responses**

- `200 OK` – Rekognition response payload (labels, confidence scores, bounding boxes).
- `4xx / 5xx` – API Gateway JSON error format. Most failures originate from invalid S3 permissions or Rekognition throttling.

### `/images` Request

```http
POST /images HTTP/1.1
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "Id": "workflow-2025-10-25-001",
  "ImageS3Prefix": "uploads/2025/10/25/workflow-2025-10-25-001/",
  "Prompt": "Replace the background with a modern office scene.",
  "NegativePrompt": "Avoid reflections or motion blur.",
  "Mode": "BACKGROUND_REPLACE",
  "Images": [
    { "ImageName": "portrait-1.png", "Labels": "portrait,person" },
    { "ImageName": "portrait-2.png", "Labels": "portrait,person" }
  ]
}
```

**Responses**

- `200 OK` – Empty body (DynamoDB PutItem success).  
- `400 Bad Request` – Validation errors (missing properties).  
- `500 Internal Server Error` – Integration failures (DynamoDB throttling, IAM permission issues).

## Streamlit UI Compatibility

- The UI reads `API_BASE_URL`, `COGNITO_USER_POOL_ID`, and `COGNITO_APP_CLIENT_ID` from environment variables (see `docs/configuration-reference.md` for outputs).  
- Ensure the UI bucket configuration matches the prefixes defined in the CDK configuration (`imagePrefix`, `generatedImagePrefix`, `statusReportPrefix`).  
- If new endpoints are introduced, update `src/tests` and the UI service to align on payload contracts.

## Error Handling Guidelines

| Scenario | User-Facing Behaviour | Remediation |
| -------- | --------------------- | ----------- |
| Cognito token expired | UI receives `401 Unauthorized` | Re-authenticate the user; tokens typically last 1 hour. |
| Rekognition throttled (`/detectLabels`) | UI sees `429` or retry-able `5xx` | Retry with exponential backoff; monitor CloudWatch metrics. |
| DynamoDB conditional failures (`/images`) | UI receives `400` | Verify payload uniqueness (`Id`) and DynamoDB table availability. |
| Step Functions workflow failures | UI polls status bucket and sees failure report | Inspect Step Functions execution history (`docs/testing-validation.md`). |

## Testing Utilities

- Run `yarn test api-stack.integration.test.ts` to validate IAM roles, request templates, and authorizers.
- Use `docs/testing-validation.md` for manual API invocation scripts.

## Change Log

- **2025-10-25** – Added ARN environment wiring to compute stack and refreshed integration documentation.
