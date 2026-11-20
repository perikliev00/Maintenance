provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "meridian-maintenance"
      ManagedBy = "terraform"
      Stack     = var.stack_name
    }
  }
}
