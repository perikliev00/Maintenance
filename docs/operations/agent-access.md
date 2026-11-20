# AI agent access to the production EC2 host

Preferred control plane: **AWS Systems Manager (SSM)**. Do not open inbound SSH. Do not grant `AdministratorAccess` to the agent.

## Connection (first time)

1. Operator applies Terraform and confirms SSM agent is `Online` (see [`aws-ec2.md`](./aws-ec2.md)).
2. Agent (or operator) assumes the appropriate IAM role with ExternalId, then:

```sh
export AWS_REGION=eu-central-1
export EC2_INSTANCE_ID=i-…
# Interactive shell (ops/admin tiers; diag may be limited by policy):
./scripts/aws/ssm-session.sh
```

Or non-interactive diagnostics:

```sh
./scripts/aws/ssm-diag.sh
```

## Three permission tiers

| Tier | IAM role (Terraform) | Allowed | Not allowed |
|---|---|---|---|
| **1 — Diagnostics** | `maintenance-agent-diag` | Describe EC2/SSM, CloudWatch metrics read, SSM document `maintenance-diag`, limited session | Promote, rollback, arbitrary shell, secrets write |
| **2 — Standard ops** | `maintenance-agent-ops` | Diag + `maintenance-promote` + `maintenance-rollback-app` + session | Admin document, destructive DB, IAM changes |
| **3 — Admin** | `maintenance-agent-admin` | Allowlisted admin actions (`restart-stack`, `status`, `journal-backup`, `compose-ps`) with `APPROVAL_TOKEN=ADMIN_APPROVED` | Free-form production shell as policy default; still no `AdministratorAccess` |

Assume examples (operator-managed principal in the same account):

```sh
aws sts assume-role \
  --role-arn arn:aws:iam::ACCOUNT:role/maintenance-agent-diag \
  --role-session-name agent-diag \
  --external-id maintenance-agent-diag
```

Use ExternalIds:

- `maintenance-agent-diag`
- `maintenance-agent-ops`
- `maintenance-agent-admin`

## Standard deployment operations (tier 2)

```sh
export RELEASE_SHA=<40-char-sha>
./scripts/aws/ssm-promote.sh
APP_URL=https://$APP_DOMAIN ./scripts/post-deploy-smoke.sh
```

Application-only rollback (no database rollback):

```sh
./scripts/aws/ssm-rollback-app.sh
```

## Actions that require explicit human approval

- `terraform apply` / destroy / EC2 resize
- Rotating production secrets
- Enabling/disabling Environment required reviewers
- Database restore into any non-disposable target
- Running `maintenance-admin-shell` document
- Opening SSH in the security group
- Any destructive Prisma / SQL migration outside expand/contract policy

## GitHub Actions identity

Deployments use OIDC role `maintenance-gha-deploy` (short-lived). It may only `ssm:SendCommand` the promote document to the single instance and read command results. It cannot assume admin role and cannot delete the database.

## Failure diagnostics

On deploy failure, Actions runs `ssm-diag.sh` and prints host/container health. Secrets must never appear in logs. Fix forward or roll back the **application** SHA when schema-compatible; otherwise follow [`db-recovery.md`](./db-recovery.md) with owner approval.
