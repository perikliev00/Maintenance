output "aws_region" {
  value = var.aws_region
}

output "ec2_instance_id" {
  value = aws_instance.app.id
}

output "ec2_public_ip" {
  value = var.allocate_eip ? aws_eip.app[0].public_ip : aws_instance.app.public_ip
}

output "security_group_id" {
  value = aws_security_group.app.id
}

output "gha_deploy_role_arn" {
  value = aws_iam_role.gha_deploy.arn
}

output "agent_diag_role_arn" {
  value = aws_iam_role.agent_diag.arn
}

output "agent_ops_role_arn" {
  value = aws_iam_role.agent_ops.arn
}

output "agent_admin_role_arn" {
  value = aws_iam_role.agent_admin.arn
}

output "backup_role_arn" {
  value = aws_iam_role.backup.arn
}

output "backup_bucket" {
  value = aws_s3_bucket.backups.bucket
}

output "backup_s3_uri" {
  value = "s3://${aws_s3_bucket.backups.bucket}/${local.backup_prefix}"
}

output "ssm_document_promote" {
  value = aws_ssm_document.promote.name
}

output "ssm_document_diag" {
  value = aws_ssm_document.diag.name
}

output "ssm_document_rollback_app" {
  value = aws_ssm_document.rollback_app.name
}

output "secrets_ghcr_name" {
  value = aws_secretsmanager_secret.ghcr_pull.name
}

output "secrets_env_production_name" {
  value = aws_secretsmanager_secret.env_production.name
}

output "github_environment_vars" {
  description = "Values to configure on the GitHub Environment used by deploy.yml"
  value = {
    AWS_ROLE_ARN    = aws_iam_role.gha_deploy.arn
    EC2_INSTANCE_ID = aws_instance.app.id
    DEPLOY_PATH     = var.deploy_path
    APP_URL         = "https://${var.app_domain}"
    IMAGE_PREFIX    = "ghcr.io/${lower(var.github_org)}"
    AWS_REGION      = var.aws_region
    SSM_PROMOTE_DOC = aws_ssm_document.promote.name
  }
}
