variable "aws_region" {
  description = "AWS region for Meridian Maintenance production."
  type        = string
  default     = "eu-central-1"
}

variable "stack_name" {
  description = "Short name used in resource name prefixes."
  type        = string
  default     = "maintenance"
}

variable "github_org" {
  description = "GitHub organization or user that owns the repository."
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name (without org)."
  type        = string
  default     = "maintenance"
}

variable "instance_type" {
  description = "EC2 instance type."
  type        = string
  default     = "t3.medium"
}

variable "root_volume_gb" {
  description = "Encrypted root EBS volume size in GiB."
  type        = number
  default     = 40
}

variable "app_domain" {
  description = "Public DNS name for APP_DOMAIN / Caddy."
  type        = string
}

variable "allowed_ssh_cidrs" {
  description = "Empty by default. SSM is the supported access path; do not open SSH unless explicitly required."
  type        = list(string)
  default     = []
}

variable "git_clone_url" {
  description = "HTTPS git URL cloned onto the host by cloud-init."
  type        = string
}

variable "git_ref" {
  description = "Initial git ref checked out on first boot (branch or SHA)."
  type        = string
  default     = "main"
}

variable "deploy_path" {
  description = "Absolute path for the application checkout on the host."
  type        = string
  default     = "/opt/maintenance"
}

variable "backup_retention_days" {
  description = "S3 lifecycle expiration for encrypted database backups."
  type        = number
  default     = 35
}

variable "create_github_oidc_provider" {
  description = "Create the GitHub OIDC provider. Set false and pass existing_oidc_provider_arn if the account already has one."
  type        = bool
  default     = true
}

variable "existing_oidc_provider_arn" {
  description = "Existing GitHub OIDC provider ARN when create_github_oidc_provider is false."
  type        = string
  default     = ""
}

variable "vpc_id" {
  description = "VPC for the EC2 instance. Empty = default VPC."
  type        = string
  default     = ""
}

variable "subnet_id" {
  description = "Subnet for the EC2 instance. Empty = first default-VPC public subnet."
  type        = string
  default     = ""
}

variable "allocate_eip" {
  description = "Allocate and associate an Elastic IP for stable DNS."
  type        = bool
  default     = true
}

variable "ami_id" {
  description = "Optional Ubuntu 24.04 AMI override. Empty = latest official Ubuntu 24.04 from Canonical."
  type        = string
  default     = ""
}
