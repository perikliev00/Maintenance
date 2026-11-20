#!/usr/bin/env bash
# Start an SSM Session Manager shell to the maintenance EC2 instance.
set -euo pipefail

: "${EC2_INSTANCE_ID:?Set EC2_INSTANCE_ID}"
: "${AWS_REGION:?Set AWS_REGION (e.g. eu-central-1)}"

echo "Starting SSM session to $EC2_INSTANCE_ID in $AWS_REGION ..."
exec aws ssm start-session \
  --region "$AWS_REGION" \
  --target "$EC2_INSTANCE_ID"
