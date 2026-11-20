#!/usr/bin/env bash
# Agent tier 2 / GHA: promote a release SHA via SSM document.
set -euo pipefail

: "${EC2_INSTANCE_ID:?Set EC2_INSTANCE_ID}"
: "${AWS_REGION:?Set AWS_REGION (e.g. eu-central-1)}"
: "${RELEASE_SHA:?Set RELEASE_SHA to a 40-char git SHA}"
DOC_NAME="${SSM_PROMOTE_DOC:-maintenance-promote}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/maintenance}"

[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || {
  echo "RELEASE_SHA must be a full 40-char hex SHA" >&2
  exit 2
}

cmd_id="$(aws ssm send-command \
  --region "$AWS_REGION" \
  --instance-ids "$EC2_INSTANCE_ID" \
  --document-name "$DOC_NAME" \
  --comment "maintenance promote $RELEASE_SHA" \
  --parameters "ReleaseSha=$RELEASE_SHA,DeployPath=$DEPLOY_PATH" \
  --query 'Command.CommandId' \
  --output text)"

echo "CommandId=$cmd_id"
aws ssm wait command-executed \
  --region "$AWS_REGION" \
  --command-id "$cmd_id" \
  --instance-id "$EC2_INSTANCE_ID"

inv="$(aws ssm get-command-invocation \
  --region "$AWS_REGION" \
  --command-id "$cmd_id" \
  --instance-id "$EC2_INSTANCE_ID" \
  --output json)"
echo "$inv" | jq '{Status,ResponseCode,Stdout: .StandardOutputContent,Stderr: .StandardErrorContent}'
status="$(echo "$inv" | jq -r .Status)"
[[ "$status" == "Success" ]]
