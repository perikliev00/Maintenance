resource "aws_ssm_document" "promote" {
  name            = "${local.name_prefix}-promote"
  document_type   = "Command"
  document_format = "YAML"

  content = <<-DOC
    schemaVersion: "2.2"
    description: "Promote an immutable Meridian Maintenance release by SHA (no compose build)."
    parameters:
      ReleaseSha:
        type: String
        description: "Full 40-char git SHA with published GHCR images"
        allowedPattern: "^[0-9a-f]{40}$"
      DeployPath:
        type: String
        default: "${var.deploy_path}"
        allowedPattern: "^/[A-Za-z0-9._/-]+$"
    mainSteps:
      - action: aws:runShellScript
        name: promoteRelease
        inputs:
          timeoutSeconds: "900"
          runCommand:
            - |
              set -euo pipefail
              export RELEASE_SHA="{{ ReleaseSha }}"
              export DEPLOY_PATH="{{ DeployPath }}"
              sudo -u maintenance -H --preserve-env=RELEASE_SHA,DEPLOY_PATH \
                /usr/local/bin/maintenance-promote-release.sh
  DOC
}

resource "aws_ssm_document" "diag" {
  name            = "${local.name_prefix}-diag"
  document_type   = "Command"
  document_format = "YAML"

  content = <<-DOC
    schemaVersion: "2.2"
    description: "Read-only host and container diagnostics for Meridian Maintenance."
    parameters:
      DeployPath:
        type: String
        default: "${var.deploy_path}"
        allowedPattern: "^/[A-Za-z0-9._/-]+$"
    mainSteps:
      - action: aws:runShellScript
        name: hostHealth
        inputs:
          timeoutSeconds: "120"
          runCommand:
            - |
              set -euo pipefail
              export DEPLOY_PATH="{{ DeployPath }}"
              /usr/local/bin/maintenance-host-health.sh
  DOC
}

resource "aws_ssm_document" "rollback_app" {
  name            = "${local.name_prefix}-rollback-app"
  document_type   = "Command"
  document_format = "YAML"

  content = <<-DOC
    schemaVersion: "2.2"
    description: "Application-only rollback to the previous RELEASE_SHA (no database rollback)."
    parameters:
      DeployPath:
        type: String
        default: "${var.deploy_path}"
        allowedPattern: "^/[A-Za-z0-9._/-]+$"
      Confirm:
        type: String
        description: "Must equal ROLLBACK_APP to proceed"
        allowedPattern: "^ROLLBACK_APP$"
    mainSteps:
      - action: aws:runShellScript
        name: rollbackApp
        inputs:
          timeoutSeconds: "900"
          runCommand:
            - |
              set -euo pipefail
              export DEPLOY_PATH="{{ DeployPath }}"
              export ROLLBACK_CONFIRM="{{ Confirm }}"
              sudo -u maintenance -H --preserve-env=DEPLOY_PATH,ROLLBACK_CONFIRM \
                /usr/local/bin/maintenance-rollback-app.sh
  DOC
}

resource "aws_ssm_document" "admin_shell" {
  name            = "${local.name_prefix}-admin-shell"
  document_type   = "Command"
  document_format = "YAML"

  content = <<-DOC
    schemaVersion: "2.2"
    description: "Admin-only allowlisted shell helper. Destructive DB ops are refused by the script."
    parameters:
      AdminAction:
        type: String
        description: "One of restart-stack|status|journal-backup|compose-ps"
        allowedValues:
          - restart-stack
          - status
          - journal-backup
          - compose-ps
      DeployPath:
        type: String
        default: "${var.deploy_path}"
        allowedPattern: "^/[A-Za-z0-9._/-]+$"
      ApprovalToken:
        type: String
        description: "Must equal ADMIN_APPROVED"
        allowedPattern: "^ADMIN_APPROVED$"
    mainSteps:
      - action: aws:runShellScript
        name: adminAction
        inputs:
          timeoutSeconds: "300"
          runCommand:
            - |
              set -euo pipefail
              export DEPLOY_PATH="{{ DeployPath }}"
              export ADMIN_ACTION="{{ AdminAction }}"
              export APPROVAL_TOKEN="{{ ApprovalToken }}"
              /usr/local/bin/maintenance-admin-action.sh
  DOC
}
