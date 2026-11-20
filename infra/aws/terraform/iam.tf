################################################################################
# EC2 instance role / profile (SSM + secrets read + assume backup role)
################################################################################

resource "aws_iam_role" "ec2" {
  name               = "${local.name_prefix}-ec2"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "ec2_ssm_core" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "ec2_runtime" {
  statement {
    sid = "ReadDeploySecrets"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = [
      aws_secretsmanager_secret.ghcr_pull.arn,
      aws_secretsmanager_secret.env_production.arn,
    ]
  }

  statement {
    sid = "ReadNonSecretParams"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
    ]
    resources = [
      "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${local.name_prefix}/*",
    ]
  }

  statement {
    sid       = "AssumeBackupUploader"
    actions   = ["sts:AssumeRole"]
    resources = [aws_iam_role.backup.arn]
  }
}

resource "aws_iam_role_policy" "ec2_runtime" {
  name   = "${local.name_prefix}-ec2-runtime"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.ec2_runtime.json
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${local.name_prefix}-ec2"
  role = aws_iam_role.ec2.name
}

################################################################################
# Dedicated backup uploader (least privilege S3)
################################################################################

data "aws_iam_policy_document" "backup_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type = "AWS"
      identifiers = [
        aws_iam_role.ec2.arn,
      ]
    }
  }
}

resource "aws_iam_role" "backup" {
  name               = "${local.name_prefix}-backup-uploader"
  assume_role_policy = data.aws_iam_policy_document.backup_assume.json
}

data "aws_iam_policy_document" "backup_s3" {
  statement {
    sid = "ListBackupPrefix"
    actions = [
      "s3:ListBucket",
    ]
    resources = [aws_s3_bucket.backups.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = [local.backup_prefix, "${local.backup_prefix}*"]
    }
  }

  statement {
    sid = "PutEncryptedBackups"
    actions = [
      "s3:PutObject",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
    ]
    resources = ["${aws_s3_bucket.backups.arn}/${local.backup_prefix}*"]
  }
}

resource "aws_iam_role_policy" "backup_s3" {
  name   = "${local.name_prefix}-backup-s3"
  role   = aws_iam_role.backup.id
  policy = data.aws_iam_policy_document.backup_s3.json
}

################################################################################
# GitHub Actions deploy role (OIDC) — promote only
################################################################################

resource "aws_iam_role" "gha_deploy" {
  name               = "${local.name_prefix}-gha-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_oidc_assume_deploy.json
}

data "aws_iam_policy_document" "gha_deploy" {
  statement {
    sid = "SendPromoteCommand"
    actions = [
      "ssm:SendCommand",
    ]
    resources = [
      aws_ssm_document.promote.arn,
      "arn:${data.aws_partition.current.partition}:ec2:${var.aws_region}:${data.aws_caller_identity.current.account_id}:instance/${aws_instance.app.id}",
    ]
  }

  statement {
    sid = "ReadCommandResults"
    actions = [
      "ssm:GetCommandInvocation",
      "ssm:ListCommandInvocations",
      "ssm:DescribeInstanceInformation",
      "ssm:DescribeInstanceProperties",
    ]
    resources = ["*"]
  }

  statement {
    sid = "DescribeTargetInstance"
    actions = [
      "ec2:DescribeInstances",
      "ec2:DescribeInstanceStatus",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "gha_deploy" {
  name   = "${local.name_prefix}-gha-deploy"
  role   = aws_iam_role.gha_deploy.id
  policy = data.aws_iam_policy_document.gha_deploy.json
}

################################################################################
# Agent tier 1 — diagnostics (read-only)
################################################################################

resource "aws_iam_role" "agent_diag" {
  name               = "${local.name_prefix}-agent-diag"
  assume_role_policy = data.aws_iam_policy_document.agent_diag_trust.json
}

data "aws_iam_policy_document" "agent_diag" {
  statement {
    sid = "ReadOnlyDescribe"
    actions = [
      "ec2:DescribeInstances",
      "ec2:DescribeInstanceStatus",
      "ec2:DescribeSecurityGroups",
      "ssm:DescribeInstanceInformation",
      "ssm:DescribeInstanceProperties",
      "ssm:GetCommandInvocation",
      "ssm:ListCommandInvocations",
      "ssm:DescribeDocument",
      "cloudwatch:GetMetricData",
      "cloudwatch:GetMetricStatistics",
      "cloudwatch:ListMetrics",
    ]
    resources = ["*"]
  }

  statement {
    sid = "StartReadOnlySession"
    actions = [
      "ssm:StartSession",
    ]
    resources = [
      "arn:${data.aws_partition.current.partition}:ec2:${var.aws_region}:${data.aws_caller_identity.current.account_id}:instance/${aws_instance.app.id}",
      "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}::document/AWS-StartInteractiveCommand",
    ]
  }

  statement {
    sid = "SendDiagDocumentOnly"
    actions = [
      "ssm:SendCommand",
    ]
    resources = [
      aws_ssm_document.diag.arn,
      "arn:${data.aws_partition.current.partition}:ec2:${var.aws_region}:${data.aws_caller_identity.current.account_id}:instance/${aws_instance.app.id}",
    ]
  }
}

resource "aws_iam_role_policy" "agent_diag" {
  name   = "${local.name_prefix}-agent-diag"
  role   = aws_iam_role.agent_diag.id
  policy = data.aws_iam_policy_document.agent_diag.json
}

################################################################################
# Agent tier 2 — standard deploy ops (allowlisted)
################################################################################

resource "aws_iam_role" "agent_ops" {
  name               = "${local.name_prefix}-agent-ops"
  assume_role_policy = data.aws_iam_policy_document.agent_ops_trust.json
}

data "aws_iam_policy_document" "agent_ops" {
  statement {
    sid = "DescribeAndReadResults"
    actions = [
      "ec2:DescribeInstances",
      "ec2:DescribeInstanceStatus",
      "ssm:DescribeInstanceInformation",
      "ssm:GetCommandInvocation",
      "ssm:ListCommandInvocations",
    ]
    resources = ["*"]
  }

  statement {
    sid = "AllowlistedOpsDocuments"
    actions = [
      "ssm:SendCommand",
    ]
    resources = [
      aws_ssm_document.promote.arn,
      aws_ssm_document.diag.arn,
      aws_ssm_document.rollback_app.arn,
      "arn:${data.aws_partition.current.partition}:ec2:${var.aws_region}:${data.aws_caller_identity.current.account_id}:instance/${aws_instance.app.id}",
    ]
  }

  statement {
    sid = "SessionForOps"
    actions = [
      "ssm:StartSession",
    ]
    resources = [
      "arn:${data.aws_partition.current.partition}:ec2:${var.aws_region}:${data.aws_caller_identity.current.account_id}:instance/${aws_instance.app.id}",
      "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}::document/AWS-StartInteractiveCommand",
      "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}::document/AWS-StartSSHSession",
    ]
  }
}

resource "aws_iam_role_policy" "agent_ops" {
  name   = "${local.name_prefix}-agent-ops"
  role   = aws_iam_role.agent_ops.id
  policy = data.aws_iam_policy_document.agent_ops.json
}

################################################################################
# Agent tier 3 — admin (explicit approval / separate assume)
################################################################################

resource "aws_iam_role" "agent_admin" {
  name               = "${local.name_prefix}-agent-admin"
  assume_role_policy = data.aws_iam_policy_document.agent_admin_trust.json
}

data "aws_iam_policy_document" "agent_admin" {
  statement {
    sid = "AdminDescribe"
    actions = [
      "ec2:Describe*",
      "ssm:Describe*",
      "ssm:GetCommandInvocation",
      "ssm:ListCommandInvocations",
      "ssm:ListDocuments",
      "ssm:GetDocument",
    ]
    resources = ["*"]
  }

  statement {
    sid = "AdminSendAllowlistedPlusShell"
    actions = [
      "ssm:SendCommand",
    ]
    resources = [
      aws_ssm_document.promote.arn,
      aws_ssm_document.diag.arn,
      aws_ssm_document.rollback_app.arn,
      aws_ssm_document.admin_shell.arn,
      "arn:${data.aws_partition.current.partition}:ec2:${var.aws_region}:${data.aws_caller_identity.current.account_id}:instance/${aws_instance.app.id}",
    ]
  }

  statement {
    sid = "AdminSession"
    actions = [
      "ssm:StartSession",
      "ssm:ResumeSession",
      "ssm:TerminateSession",
    ]
    resources = [
      "arn:${data.aws_partition.current.partition}:ec2:${var.aws_region}:${data.aws_caller_identity.current.account_id}:instance/${aws_instance.app.id}",
      "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:session/*",
      "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}::document/AWS-StartInteractiveCommand",
      "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}::document/SSM-SessionManagerRunShell",
    ]
  }
}

resource "aws_iam_role_policy" "agent_admin" {
  name   = "${local.name_prefix}-agent-admin"
  role   = aws_iam_role.agent_admin.id
  policy = data.aws_iam_policy_document.agent_admin.json
}

################################################################################
# Secrets Manager placeholders (values set out-of-band; never commit secrets)
################################################################################

resource "aws_secretsmanager_secret" "ghcr_pull" {
  name                    = local.secret_ghcr_name
  description             = "GHCR read-only token for docker pull on the EC2 host"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "env_production" {
  name                    = local.secret_env_name
  description             = "Contents of .env.production for /etc/maintenance (set via CLI, not Terraform)"
  recovery_window_in_days = 7
}

resource "aws_ssm_parameter" "app_domain" {
  name  = "/${local.name_prefix}/app_domain"
  type  = "String"
  value = var.app_domain
}

resource "aws_ssm_parameter" "deploy_path" {
  name  = "/${local.name_prefix}/deploy_path"
  type  = "String"
  value = var.deploy_path
}

resource "aws_ssm_parameter" "backup_s3_uri" {
  name  = "/${local.name_prefix}/backup_s3_uri"
  type  = "String"
  value = "s3://${aws_s3_bucket.backups.bucket}/${local.backup_prefix}"
}
