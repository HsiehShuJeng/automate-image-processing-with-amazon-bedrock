# SAM to CDK Migration Notes

This document captures the end-to-end journey from the legacy AWS SAM implementation to the modular AWS CDK application. Use it as the canonical reference when explaining design trade-offs, onboarding new contributors, or auditing the migration.

## Migration Overview

| Legacy SAM Component | CDK Replacement | Key Notes |
| -------------------- | --------------- | --------- |
| `template.yaml` globals and nested resources | Dedicated stacks under `lib/constructs/` (`storage`, `auth`, `api`, `compute`, `orchestration`, `notification`, `monitoring`) | Logical separation simplifies testing, security reviews, and partial deployments. |
| Inline IAM policies inside SAM resources | Fine-grained policies per construct with CDK Nag validation | Centralised suppressions documented under `lib/utils/security-suppressions.ts`. |
| SAM `Globals` for Lambda config | `ImageProcessingConfig` with environment overrides | Runtime, timeout, and Powertools settings live in TypeScript and propagate via configuration files. |
| SAM Step Functions definition | CDK `sfn.StateMachine` definition composed from compute outputs | Maintains distributed map semantics with cross-stack function ARNs via exports. |
| SAM API Gateway with inline integrations | `ApiStack` with explicit IAM roles and VTL templates | Adds structured logging, tracing, and throttling defaults. |
| AWS CLI/CloudFormation deploy scripts | `scripts/deploy.js` with health checks, stack policies, and context-aware deployments | Supports per-environment overrides via `config/environments/*.json`. |

### Migration Checklist

1. **Inventory & Parity**  
   - Export the SAM CloudFormation stack to document existing resources.  
   - Map each resource to the target CDK construct (table above).  
   - Identify configuration values that should become parameters (`config/environments/*.json`).
2. **Iterative Porting**  
   - Scaffold the CDK app (`Step 1`–`Step 7` in `.kiro/specs/.../tasks.md`).  
   - Port storage → auth → API → compute → orchestration → notification → monitoring layers, running targeted Jest suites per feature.  
   - Keep parity snapshots to detect infrastructure regressions.
3. **Security & Compliance Alignment**  
   - Add CDK Nag checks and document suppressions with rationale.  
   - Enforce TLS and account restrictions through bucket/table/topic policies.  
   - Apply Powertools instrumentation for auditability.
4. **Deployment Enablement**  
   - Implement environment discovery (`loadDeploymentTargets`) with JSON descriptors.  
   - Create deployment wrapper (`scripts/deploy.js`) and validate cross-environment tagging/termination protection.  
   - Update operations runbook and production checklist.
5. **Validation & Sign-off**  
   - Execute Jest suites, `cdk synth`, and manual workflow walkthroughs.  
   - Perform Step 28 end-to-end testing (see `docs/testing-validation.md`).  
   - Capture lessons learned and update this document’s “Outstanding Considerations”.

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
- See `docs/configuration-reference.md` for environment parameter breakdown.
- See `docs/api-integration-guide.md` for REST endpoint compatibility notes.

## Outstanding Considerations
- Update the environment JSON files with production account/regions prior to live deployment.
- Replace development `RemovalPolicy.DESTROY` flags with `RETAIN` for production environments.
- Add email subscriptions for staging/production SNS topics as required by operations.
