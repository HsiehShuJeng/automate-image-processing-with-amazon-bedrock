# Testing & Validation Checklist

## Automated Tests
- `yarn test`: Runs Jest unit tests for all stacks and Lambda handlers.
- `npx cdk synth`: Generates CloudFormation templates for review in `cdk.out/`.

### Step 28 Execution Summary (2025-10-25)
- ✅ `yarn test --runInBand` (142 passing tests, snapshots refreshed for infrastructure changes)
- ✅ `npx cdk synth`
- ➖ `python3 -m pytest src/tests` *(requires installing `pytest`; skipped in sandbox)*
  - Install locally via `pip install pytest` to execute Lambda handler unit tests with bundled stubs.

## Manual Validation
1. Execute a sample API `POST /images` request via Postman using Cognito token to ensure DynamoDB writes succeed.
2. Upload an image record to the Images table to trigger the compute workflow.
3. Confirm Step Functions execution succeeds and generates processed images + status report.
4. Verify notification email (SNS) contains statuses and S3 locations.

### Sample Workflow Walkthrough
```bash
# 1. Authenticate against Cognito and capture the access token
aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id "$USER_POOL_CLIENT_ID" \
  --auth-parameters USERNAME="$USERNAME",PASSWORD="$PASSWORD" \
  --region ap-northeast-1

# 2. POST the sample payload to /images
curl -X POST "$API_BASE_URL/images" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d @<(cat <<'PAYLOAD'
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
PAYLOAD
)

# 3. Confirm DynamoDB write
aws dynamodb get-item \
  --table-name ImagesTable \
  --key '{"Id":{"S":"workflow-2025-10-25-001"}}'

# 4. Track the Step Functions execution
EXECUTION_ARN=$(aws stepfunctions list-executions \
  --state-machine-arn "$STATE_MACHINE_IMAGE_PROCESSING_ARN" \
  --status-filter RUNNING \
  --max-items 1 \
  --query 'executions[0].executionArn' \
  --output text)
aws stepfunctions describe-execution --execution-arn "$EXECUTION_ARN"

# 5. Verify status report artifact and SNS email
aws s3 ls "s3://$STATUS_BUCKET/status-report-files/uploads/2025/10/25/workflow-2025-10-25-001/"
```

> Tip: Maintain a reusable test asset set (for example `s3://$INPUT_BUCKET/test-assets/portraits/`) so that end-to-end validation can be repeated across environments without modifying code.

## Security Validation
- Run `yarn test monitoring-stack.test.ts` to ensure alarms reference the encrypted SNS topic.
- Review CDK Nag output (via tests under `test/*nag.test.ts`) to confirm no new high-severity findings.

## Performance Considerations
- Distributed Map concurrency set by configuration (`config.maxConcurrency`). Adjust per environment requirements.
- Lambda memory/timeout values mirror SAM template defaults; monitor CloudWatch metrics and tune as needed.

### Error Scenario & Resiliency Checks
- **Missing S3 object**: Update one image entry with a bogus key and confirm the workflow records the failure path and surfaces a clear error in Step Functions.
- **Bedrock throttling**: Use Step Functions test events to inject a `ThrottlingException` and validate retry/backoff behaviour.
- **SNS delivery**: Temporarily disable the email subscription and check CloudWatch metrics/Dead Letter Queues remain healthy.

### Load & Concurrency Exercises
1. Clone the sample `/images` payload with unique workflow IDs (`workflow-001` … `workflow-020`).
2. Run concurrent requests from a workstation or CI runner (example using `hey`):
   ```bash
   hey -n 20 -c 5 \
     -H "Authorization: Bearer $ACCESS_TOKEN" \
     -m POST -T application/json \
     -D bulk-images.json \
     "$API_BASE_URL/images"
   ```
3. Monitor the CloudWatch dashboard for Lambda duration, errors, DynamoDB throttles, and Step Functions concurrent map executions.

## Sign-off Template
- [ ] Unit tests passed (`yarn test`).
- [ ] CDK synth matches expectations.
- [ ] Manual workflow executed successfully.
- [ ] Monitoring dashboard reviewed.
- [ ] Alarms verified to notify SNS subscribers.
