# SAM to CDK Migration Notes

This document records the design decisions and implementation updates completed while migrating the image processing solution from AWS SAM to AWS CDK.

## Lambda Layers
- Import the managed AWS Lambda Powertools layer via SSM parameter resolution so the deployment always uses the latest regional release without packaging local assets.
- Added `layers/common-utils` providing shared observability helpers (`logger`, `tracer`, `metrics`).
- All compute Lambdas consume the layers to avoid duplicating dependencies.
- `ComputeStack` exposes optional runtime/architecture overrides so teams can align Lambda builds with regional runtime availability or Graviton adoption plans without altering stack internals.

## Powertools Adoption
- `src/start-image-processing-workflow/app.py` now uses Powertools logging, tracing, and metrics to align with the other compute handlers.
- Correlation IDs are extracted from DynamoDB stream events to provide consistent trace linkage.
- Cold start, success, and failure metrics are emitted for workflow executions.

## IAM and Resource Policies
- Added default-deny TLS enforcement for the image bucket and both DynamoDB tables.
- Restricted DynamoDB access to the owning account via resource policies.
- Introduced SNS topic resource policies to require TLS and restrict publishers to the account.

## Observability Enhancements
- Enabled X-Ray tracing and log retention for all compute Lambdas.
- Configured API Gateway to emit structured access logs, method metrics, and tracing data.
- Created a dedicated Monitoring stack producing CloudWatch dashboards and alarms wired to the notification topic.

## Deployment Configuration
- Added environment JSON descriptors in `config/environments/` with account, region, tagging, and configuration overrides.
- Updated `loadDeploymentTargets` to read context + file based environments, including termination protection settings.
- Added `scripts/deploy.js` to deploy a specific environment (`node scripts/deploy.js dev`).
- Deployment script now defaults to the `default` AWS CLI profile, applies stack policies to protect storage/notification resources, and performs post-deploy health checks via the AWS CLI.

## Documentation & Runbooks
- See `docs/operations-runbook.md` for deployment and troubleshooting procedures.
- See `docs/security-controls.md` for IAM and policy rationale.
- See `docs/testing-validation.md` for validation steps and coverage.

## Outstanding Considerations
- Update the environment JSON files with production account/regions prior to live deployment.
- Replace development `RemovalPolicy.DESTROY` flags with `RETAIN` for production environments.
- Add email subscriptions for staging/production SNS topics as required by operations.
