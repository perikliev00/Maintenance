#!/usr/bin/env bash
# Agent tier 2: application-only rollback via SSM (requires ROLLBACK_APP confirm).
set -euo pipefail

: "${EC2_INSTANCE_ID:?Set EC2_INSTANCE_ID}"
: "${AWS_REGION:?Set AWS_REGION}"
DOC_NAME="${SSM_ROLLBACK_DOC:-maintenance-rollback-app}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/maintenance}"

cmd_id="$(aws ssm send-command \
  --region "$AWS_REGION" \
  --instance-ids "$EC2_INSTANCE_ID" \
  --document-name "$DOC_NAME" \
  --comment "maintenance app rollback" \
  --parameters "DeployPath=$DEPLOY_PATH,Confirm=ROLLBACK_APP" \
  --query 'Command.CommandId' \
  --output text)"

echo "CommandId=$cmd_id"
aws ssm wait command-executed \
  --region "$AWS_REGION" \
  --command-id "$cmd_id" \
  --instance-id "$EC2_INSTANCE_ID"

aws ssm get-command-invocation \
  --region "$AWS_REGION" \
  --command-id "$cmd_id" \
  --instance-id "$EC2_INSTANCE_ID" \
  --query '{Status:Status,Stdout:StandardOutputContent,Stderr:StandardErrorContent}' \
  --output json
