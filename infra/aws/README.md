# AWS EC2 infrastructure for Meridian Maintenance

- **Region default:** `eu-central-1`
- **Terraform:** [`terraform/`](./terraform/)
- **Cloud-init:** [`cloud-init/user-data.yaml`](./cloud-init/user-data.yaml)
- **Host systemd unit:** [`systemd/maintenance-stack.service`](./systemd/maintenance-stack.service)

Do not run `terraform apply` without explicit owner approval (creates paid EC2/EIP/S3 resources).

Operator docs:

- [`docs/operations/aws-ec2.md`](../../docs/operations/aws-ec2.md)
- [`docs/operations/agent-access.md`](../../docs/operations/agent-access.md)
- [`docs/operations/deploy.md`](../../docs/operations/deploy.md)
