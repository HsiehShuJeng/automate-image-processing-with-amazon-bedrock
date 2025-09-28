# Security Controls Summary

## Resource Policies
- **S3 Bucket**: Attached explicit deny for non-TLS requests, blocks public access, and enforces account-only access via bucket policies.
- **DynamoDB Tables**: Added resource policies (§ `ResourcePolicy`) denying non-TLS access and cross-account principals.
- **SNS Topic**: Restricted `Publish` to the owning account and deny insecure transport.

## IAM Policies
- Lambda roles rely on least-privilege grants from CDK constructs (bucket/table grants and Step Functions execution permissions).
- Step Functions state machine role only allows `bedrock:InvokeModel`, specific Lambda invocations, DynamoDB writes, SNS publish, and S3 object operations within the workflow bucket.
- API Gateway integration roles limited to `rekognition:DetectLabels` and `dynamodb:PutItem` for the target resources.

## Monitoring & Auditing
- CloudWatch dashboard plus alarms for Lambda errors, Step Functions failures, and API 5XX rates notify the encrypted SNS topic.
- API Gateway logging/tracing enabled; Powertools instrumentation adds structured logs, metrics, and traces for compute Lambdas.

## Data Protection
- S3 bucket uses SSE-S3 and versioning.
- DynamoDB tables employ AWS-managed encryption keys.
- SNS topic encrypted with a dedicated KMS key with rotation enabled.

## Compliance Notes
- CDK Nag checks run across all stacks with targeted suppressions documented in `lib/utils/security.ts`.
- Development removal policies (`DESTROY`) remain for non-production stacks; update to `RETAIN` prior to production cutover.

## Next Steps
- Integrate AWS Config rules for continuous compliance validation.
- Extend IAM policies to use condition keys for prefix-level S3 access if the bucket is shared across workloads.
