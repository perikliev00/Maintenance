resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["ffffffffffffffffffffffffffffffffffffffff"]

  lifecycle {
    # GitHub rotates intermediate certs; AWS now validates the TLS chain.
    # Keeping a placeholder thumbprint is required by the API shape.
    ignore_changes = [thumbprint_list]
  }
}
