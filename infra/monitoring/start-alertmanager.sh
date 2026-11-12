#!/bin/sh
# Fail on unset variables and non-zero commands.
set -eu
# Require the webhook URL that Alertmanager will POST alerts to.
: "${ALERT_WEBHOOK_URL:?Set ALERT_WEBHOOK_URL to the webhook receiver}"
# Accept only HTTP(S) webhook URLs.
case "$ALERT_WEBHOOK_URL" in
  http://*|https://*) ;;
  *) echo 'ALERT_WEBHOOK_URL must be an HTTP(S) URL' >&2; exit 2 ;;
esac
# Reject control characters that could break the URL file or config.
if printf '%s' "$ALERT_WEBHOOK_URL" | grep -q '[[:cntrl:]]'; then
  echo 'ALERT_WEBHOOK_URL must not contain control characters' >&2
  exit 2
fi
# url_file avoids YAML/shell substitution of credentials and URL punctuation.
# Restrict permissions on the temporary webhook URL file.
umask 077
# Ensure the temp directory for the webhook URL file exists.
mkdir -p /tmp/maintenance-alertmanager
# Write the webhook URL to a file consumed by Alertmanager config.
printf '%s\n' "$ALERT_WEBHOOK_URL" > /tmp/maintenance-alertmanager/webhook-url
# Replace this shell with Alertmanager, forwarding any extra CLI args.
exec /bin/alertmanager --config.file=/etc/alertmanager/alertmanager.yml "$@"
