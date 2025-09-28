# Production Deployment Checklist

## Pre-Deployment
- [ ] Review `config/environments/prod.json` for correct account, region, and notification settings.
- [ ] Enable termination protection for production stacks (set in environment JSON).
- [ ] Switch S3/DynamoDB removal policies from `DESTROY` to `RETAIN` for production environment overrides.
- [ ] Confirm SNS subscriptions include operational distribution lists.
- [ ] Validate IAM permissions through `cdk-nag` snapshot tests.

## Deployment Steps
1. `yarn build`
2. Ensure `AWS_PROFILE` is set (defaults to `default`).
3. `node scripts/deploy.js prod`
4. The script applies stack policies to protect S3, DynamoDB, and SNS resources—remove or adjust them manually before destructive actions.
5. Monitor CloudFormation stack events for all component stacks and confirm the scripted health checks pass.
6. Tag release in source control after successful deployment.

## Post-Deployment Validation
- [ ] Execute API smoke tests against `POST /detectLabels` and `POST /images`.
- [ ] Upload sample workflow data and confirm Step Functions execution success.
- [ ] Verify generated images and status reports exist in S3.
- [ ] Confirm CloudWatch alarms remain in `OK` state and dashboards render metrics.
- [ ] Ensure Powertools metrics appear in CloudWatch Metrics under `ImageProcessing` namespace.

## Rollback Readiness
- [ ] Maintain latest `cdk.out` artifacts for comparison.
- [ ] Keep previous deployment commit hash noted for rapid rollback.
- [ ] Document any manual configuration applied post-deploy.
