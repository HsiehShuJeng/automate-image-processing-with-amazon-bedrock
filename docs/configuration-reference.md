# Configuration Reference

This guide explains how deployment parameters flow through the CDK application, how to configure new environments, and what each setting controls.

## Configuration Layers

1. **Defaults (`lib/types/config.ts`)** – Mirrors the legacy SAM template defaults and acts as a baseline for every environment.
2. **Environment Overrides (`config/environments/<env>.json`)** – Optional per-environment overrides for accounts, regions, stack naming, termination protection, and configuration values.
3. **CLI Overrides (`cdk.json` context or `--context`)** – Runtime flags such as `--context deployEnvironments=staging` select the environments to deploy.

The resolution flow is illustrated below:

```
DEFAULT_CONFIG  <-- base values
     │
     ├─ merge overrides from config/environments/<env>.json (if present)
     │
     └─ merge overrides from cdk.json context (if provided)
```

All configuration objects are validated by `validateConfig` to guarantee safe defaults (email format, concurrency limits, and signed URL expiration).

## Parameter Catalogue

| Setting | Description | Default | Notes |
| ------- | ----------- | ------- | ----- |
| `apiName` | API Gateway name displayed in the console | `api-image` | Impacts CloudWatch log group naming. |
| `bucketName` | Base name for the S3 bucket | `image-processing` | The CDK stack appends the AWS account to ensure global uniqueness. |
| `imagePrefix` | Source image prefix within the bucket | `image-files` | Used by compute functions to resolve input paths. |
| `generatedImagePrefix` | Destination prefix for generated assets | `generated-image-files` | Must align with Streamlit UI expectations. |
| `statusReportPrefix` | Prefix for status report artifacts | `status-report-files` | Referenced by the GenerateStatusReport Lambda. |
| `bedrockModelId` | Target Bedrock model | `amazon.titan-image-generator-v1` | Update per region/model availability. |
| `maxConcurrency` | Step Functions distributed map concurrency | `10` | Valid range 1–1000. |
| `snsTopicName` | Notification topic identifier | `notification-topic` | Combined with stack prefix to form unique topic names. |
| `notificationEmail` | Default subscription email for alerts | `fantasticSie@hotmail.com` | Must be overridden prior to production deployment. |
| `statusReportUrlExpiration` | Signed URL TTL (seconds) | `86400` (24h) | Valid range 300–604800 seconds. |
| `imageProcessingWorkflowName` | Step Functions workflow name | `image-processing-workflow` | Used to build cross-region ARNs. |

## Environment Descriptor Schema

Example: `config/environments/dev.json`

```json
{
  "account": "123456789012",
  "region": "ap-northeast-1",
  "config": {
    "notificationEmail": "dev-notifications@example.com",
    "maxConcurrency": 5
  },
  "tags": {
    "Team": "ImageAutomation"
  },
  "terminationProtection": false
}
```

Supported properties:

- `account` / `region` – Overrides the deployment account/region (fallbacks to `CDK_DEFAULT_*`).
- `config` – Partial `ImageProcessingConfig` overrides (see table above).
- `tags` – Additional tags merged with app-level defaults (`Environment` tag is added automatically).
- `stageId` / `stackNamePrefix` – Optional custom naming if the default `ImageProcessing<Env>` convention does not fit.
- `terminationProtection` – Applies to every stack inside the stage.

## Adding a New Environment

1. Create `config/environments/<env>.json` with overrides.  
2. Add shared tags or defaults to `cdk.json` under `context.imageProcessingApp`.  
3. Deploy by running:
   ```bash
   node scripts/deploy.js <env>
   ```
   or
   ```bash
   cdk deploy --context deployEnvironments=<env>
   ```
4. Confirm the new environment appears in `loadDeploymentTargets(app)`.

## Updating Configuration Safely

- Prefer modifying environment JSON definitions; avoid hard-coding values inside stacks.  
- Run `yarn test app-config.test.ts` after changes to validate configuration loading.  
- For production-critical updates (e.g., topic email changes), follow the change management checklist in `docs/operations-runbook.md`.

## Troubleshooting

- **Missing configuration error** – Ensure the environment definition includes `notificationEmail`.  
- **Unexpected stack names** – Confirm `stageId`/`stackNamePrefix` overrides do not contain spaces or special characters.  
- **Conflicting resources** – S3 bucket names must be globally unique; adjust `bucketName` per account if necessary.  
- **Bedrock availability** – Validate the chosen `bedrockModelId` is available in the target region or update the orchestration stack to invoke in a supported region (default `us-east-1`).
