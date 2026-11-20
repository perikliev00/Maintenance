#!/usr/bin/env bash
# Agent tier 1: run read-only diagnostics via SSM.
set -euo pipefail

: "${EC2_INSTANCE_ID:?Set EC2_INSTANCE_ID}"
: "${AWS_REGION:?Set AWS_REGION (e.g. eu-central-1)}"
DOC_NAME="${SSM_DIAG_DOC:-maintenance-diag}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/maintenance}"

cmd_id="$(aws ssm send-command \
  --region "$AWS_REGION" \
  --instance-ids "$EC2_INSTANCE_ID" \
  --document-name "$DOC_NAME" \
  --comment "maintenance diag" \
  --parameters "DeployPath=$DEPLOY_PATH" \
  --query 'Command.CommandId' \
  --output text)"

echo "CommandId=$cmd_id"
aws ssm wait command-executed \
  --region "$AWS_REGION" \
  --command-id "$cmd_id" \
  --instance-id "$EC2_INSTANCE_ID" || true

aws ssm get-command-invocation \
  --region "$AWS_REGION" \
  --command-id "$cmd_id" \
  --instance-id "$EC2_INSTANCE_ID" \
  --query '{Status:Status,Stdout:StandardOutputContent,Stderr:StandardErrorContent}' \
  --output json
