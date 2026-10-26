#!/bin/sh
set -eu
: "${ALERT_WEBHOOK_URL:?Set ALERT_WEBHOOK_URL to the webhook receiver}"
case "$ALERT_WEBHOOK_URL" in
  http://*|https://*) ;;
  *) echo 'ALERT_WEBHOOK_URL must be an HTTP(S) URL' >&2; exit 2 ;;
esac
if printf '%s' "$ALERT_WEBHOOK_URL" | grep -q '[[:cntrl:]]'; then
  echo 'ALERT_WEBHOOK_URL must not contain control characters' >&2
  exit 2
fi
# url_file avoids YAML/shell substitution of credentials and URL punctuation.
umask 077
mkdir -p /tmp/maintenance-alertmanager
printf '%s\n' "$ALERT_WEBHOOK_URL" > /tmp/maintenance-alertmanager/webhook-url
exec /bin/alertmanager --config.file=/etc/alertmanager/alertmanager.yml "$@"
