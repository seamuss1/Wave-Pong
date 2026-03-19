# Wave Pong Terraform Scaffold

This Terraform scaffold does two practical things today:

- defines the deployment contract for the Wave Pong online backend
- generates the exact backend `.env` values and static-client `runtime-env.js` values needed by the repo

That keeps local development, CI, and cloud deploys aligned even before a specific hosting provider is locked in.

## What it manages

- environment metadata like `dev` or `prod`
- public control-plane and match-worker URLs
- shared secrets and service URLs
- generated config artifacts under `infra/terraform/generated/<environment>/`

## What it does not manage yet

- provider-specific app resources for Fly, Render, Railway, AWS, or GCP
- managed Postgres or Redis instances
- DNS and TLS certificates

Those pieces can be added later once the hosting provider is finalized. The current scaffold is intentionally provider-neutral so the repo contract stabilizes first.

## Usage

From the repo root:

```bash
terraform -chdir=infra/terraform init
terraform -chdir=infra/terraform plan -var-file=environments/dev.tfvars
terraform -chdir=infra/terraform apply -var-file=environments/dev.tfvars
```

After apply, take the generated files and use them in your deploy pipeline:

- `generated/<environment>/wave-pong-backend.env`
- `generated/<environment>/runtime-env.js`
- `generated/<environment>/deploy-contract.json`

The backend env file can be imported into Render, Fly secrets, Railway variables, or a container host. The runtime env file can be uploaded with the static client so `runtime/index.html` resolves the right API and WebSocket endpoints without query params.
