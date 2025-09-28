# Testing & Validation Checklist

## Automated Tests
- `yarn test`: Runs Jest unit tests for all stacks and Lambda handlers.
- `npx cdk synth`: Generates CloudFormation templates for review in `cdk.out/`.

## Manual Validation
1. Execute a sample API `POST /images` request via Postman using Cognito token to ensure DynamoDB writes succeed.
2. Upload an image record to the Images table to trigger the compute workflow.
3. Confirm Step Functions execution succeeds and generates processed images + status report.
4. Verify notification email (SNS) contains statuses and S3 locations.

## Security Validation
- Run `yarn test monitoring-stack.test.ts` to ensure alarms reference the encrypted SNS topic.
- Review CDK Nag output (via tests under `test/*nag.test.ts`) to confirm no new high-severity findings.

## Performance Considerations
- Distributed Map concurrency set by configuration (`config.maxConcurrency`). Adjust per environment requirements.
- Lambda memory/timeout values mirror SAM template defaults; monitor CloudWatch metrics and tune as needed.

## Sign-off Template
- [ ] Unit tests passed (`yarn test`).
- [ ] CDK synth matches expectations.
- [ ] Manual workflow executed successfully.
- [ ] Monitoring dashboard reviewed.
- [ ] Alarms verified to notify SNS subscribers.
