resource "aws_security_group" "app" {
  name        = "${local.name_prefix}-ec2"
  description = "Meridian Maintenance public edge (HTTP/HTTPS only)"
  vpc_id      = data.aws_vpc.selected.id

  ingress {
    description = "HTTP for ACME / redirects"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP/3 QUIC"
    from_port   = 443
    to_port     = 443
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  dynamic "ingress" {
    for_each = length(var.allowed_ssh_cidrs) > 0 ? [1] : []
    content {
      description = "Emergency SSH (discouraged; prefer SSM)"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = var.allowed_ssh_cidrs
    }
  }

  egress {
    description = "Outbound for package updates, GHCR, ACME, S3, SSM"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-ec2"
  }
}

resource "aws_instance" "app" {
  ami                    = local.ami_id
  instance_type          = var.instance_type
  subnet_id              = local.subnet_id
  iam_instance_profile   = aws_iam_instance_profile.ec2.name
  vpc_security_group_ids = [aws_security_group.app.id]

  user_data = templatefile("${path.module}/../cloud-init/user-data.yaml", {
    git_clone_url   = var.git_clone_url
    git_ref         = var.git_ref
    deploy_path     = var.deploy_path
    app_domain      = var.app_domain
    stack_name      = local.name_prefix
    aws_region      = var.aws_region
    ghcr_secret_id  = aws_secretsmanager_secret.ghcr_pull.name
    env_secret_id   = aws_secretsmanager_secret.env_production.name
    backup_role_arn = aws_iam_role.backup.arn
    backup_s3_uri   = "s3://${aws_s3_bucket.backups.bucket}/${local.backup_prefix}"
  })

  user_data_replace_on_change = false

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
    instance_metadata_tags      = "enabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_gb
    encrypted             = true
    delete_on_termination = true
  }

  monitoring = true

  tags = {
    Name    = "${local.name_prefix}-prod"
    Role    = "app"
    Project = "meridian-maintenance"
  }

  lifecycle {
    ignore_changes = [ami, user_data]
  }
}

resource "aws_eip" "app" {
  count  = var.allocate_eip ? 1 : 0
  domain = "vpc"

  tags = {
    Name = "${local.name_prefix}-eip"
  }
}

resource "aws_eip_association" "app" {
  count         = var.allocate_eip ? 1 : 0
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app[0].id
}
