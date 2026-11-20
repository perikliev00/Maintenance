# AWS EC2 production bootstrap (Ubuntu 24.04, eu-central-1)

This guide prepares a single EC2 host for Meridian Maintenance using Terraform + cloud-init + SSM. It does **not** replace [`compose.prod.yml`](../../compose.prod.yml) or Caddy.

## What Terraform creates

Under [`infra/aws/terraform/`](../../infra/aws/terraform/):

- Ubuntu 24.04 EC2 (`t3.medium` default), encrypted root volume, IMDSv2
- Security group: inbound **80/tcp, 443/tcp, 443/udp only** (no SSH by default)
- Optional Elastic IP for stable DNS
- Instance profile with SSM + Secrets Manager read + assume backup uploader role
- GitHub OIDC deploy role (short-lived credentials for Actions)
- Agent IAM roles: diag / ops / admin (see [`agent-access.md`](./agent-access.md))
- S3 backup bucket (versioned, SSE-S3, lifecycle, public access blocked)
- SSM documents: promote, diag, rollback-app, admin-shell
- Secrets Manager **placeholders** for GHCR pull token and `.env.production` (values set out-of-band)

**Paid resources:** EC2, EBS, EIP, S3 storage. Do **not** run `terraform apply` without owner approval.

## Prerequisites

1. AWS credentials with permission to create the resources above (human operator — not the agent deploy role).
2. GitHub repository with Environments `production` (and optionally `staging`).
3. Domain DNS you control for `APP_DOMAIN`.

## Apply (owner-approved)

```sh
cd infra/aws/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit github_org, app_domain, git_clone_url, …
terraform init
terraform plan -out=tfplan
# STOP: review plan cost/resources with the owner, then:
terraform apply tfplan
terraform output
```

If the account already has a GitHub OIDC provider, set:

```hcl
create_github_oidc_provider = false
existing_oidc_provider_arn  = "arn:aws:iam::ACCOUNT:oidc-provider/token.actions.githubusercontent.com"
```

## Secrets (never commit)

```sh
# GHCR read token (raw PAT) or JSON {"username":"...","token":"..."}
aws secretsmanager put-secret-value \
  --region eu-central-1 \
  --secret-id "$(terraform output -raw secrets_ghcr_name)" \
  --secret-string 'ghp_…'

# Full .env.production contents (from .env.production.example with real values)
aws secretsmanager put-secret-value \
  --region eu-central-1 \
  --secret-id "$(terraform output -raw secrets_env_production_name)" \
  --secret-string file://.env.production
```

Then re-run host bootstrap materialization via SSM (or reboot) so `/etc/maintenance/.env.production` is written and GHCR login succeeds.

## First-boot host checklist

1. Wait for instance status checks + SSM `PingStatus=Online`.
2. Confirm cloud-init: `sudo cat /var/log/cloud-init-output.log` (via SSM session).
3. Provision Postgres roles using [`infra/postgres/provision-roles.sql.example`](../../infra/postgres/provision-roles.sql.example) inside the `db` container after first `compose up`.
4. Set `/etc/maintenance/backup.env` (`DATABASE_URL` with host `db`, `BACKUP_AGE_RECIPIENT`, optional heartbeat).
5. Point DNS A/AAAA at `terraform output -raw ec2_public_ip`.
6. Configure GitHub Environment `production` variables from `terraform output github_environment_vars`.
7. Enable **Required reviewers** on the Environment for the first production deploys.
8. Run a manual Deploy workflow with a known good `RELEASE_SHA`.
9. Create the initial owner once (`initial-owner` profile) per [`deploy.md`](./deploy.md).
10. Enable monitoring profile only with a real `ALERT_WEBHOOK_URL` + external uptime ([`incident-response.md`](./incident-response.md)).

## Reboot / auto-start

`maintenance-stack.service` starts Compose with `up -d --no-build` after Docker is up. Validate:

```sh
sudo reboot
# after SSM returns Online:
./scripts/aws/ssm-diag.sh
curl --fail https://$APP_DOMAIN/api/health/ready
```

## GitHub Environment variables

| Variable | Purpose |
|---|---|
| `AWS_ROLE_ARN` | OIDC role for deploy (`*-gha-deploy`) |
| `AWS_REGION` | `eu-central-1` |
| `EC2_INSTANCE_ID` | Target instance |
| `DEPLOY_PATH` | `/opt/maintenance` |
| `APP_URL` | `https://<APP_DOMAIN>` |
| `IMAGE_PREFIX` | `ghcr.io/<owner>` |
| `SSM_PROMOTE_DOC` | `maintenance-promote` |

Protection rules (required reviewers, wait timer) are configured in the GitHub UI — checked-in YAML cannot prove they are active.

## Safety

- Never `docker compose build` on production during promote.
- Never publish Postgres port publicly.
- Never auto-rollback the database.
- Application rollback: previous SHA via `scripts/aws/ssm-rollback-app.sh` only when schema-compatible.
