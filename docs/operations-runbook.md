# Operations Runbook

## Deployment Workflow
1. Ensure AWS credentials for the target account are exported in the shell.
2. Choose the deployment environment (`dev`, `staging`, `prod`, etc.).
3. Run `yarn build` to compile TypeScript assets.
4. Deploy with `node scripts/deploy.js <environment>`.
   - The script passes `--context deployEnvironments=<environment>` to CDK, which loads the environment definition from `config/environments/<environment>.json`.
5. Verify CloudFormation stack events complete without errors. Termination protection is controlled per environment configuration.

## Post-Deployment Validation
- Run `yarn test` to confirm unit tests and assertions pass.
- Execute `npx cdk synth` and review `cdk.out/` templates for unexpected changes.
- Validate CloudWatch dashboard widgets render data once traffic flows.
- Confirm SNS email subscriptions receive alarm notifications (if configured).

## Incident Response
- Review CloudWatch alarms in the Monitoring stack dashboard (`ImageProcessing*-observability`).
- For Lambda failures: inspect function logs, trace IDs (via Powertools), and Step Functions execution history.
- For API issues: review API Gateway access logs and metrics, verify Cognito authorizer status.
- In case of repeated workflow failures, consider disabling DynamoDB stream batches temporarily to prevent retries.

## Rollback Procedure
1. Identify the last known good stack version via CloudFormation change sets or git history.
2. Re-deploy the previous commit using `node scripts/deploy.js <environment>` at that revision.
3. If rollback fails, execute `cdk deploy --rollback` manually per stack to restore the prior template.
4. Document the incident in the project tracker and update this runbook if new mitigations were required.

## Emergency Contacts
- Image Automation Engineering: `image-automation@example.com`
- Platform Operations: `platform-ops@example.com`

## Change Log
- 2024-XX-XX: Added Monitoring stack alarms, Powertools instrumentation, and resource policies for least privilege.
