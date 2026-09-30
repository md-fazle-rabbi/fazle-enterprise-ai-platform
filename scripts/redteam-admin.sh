#!/usr/bin/env bash
# Red-team: backend must refuse a non-admin (alice) on /admin/kill-switch/*,
# independent of the web UI redirect. Temporary Keycloak client, always cleaned up.
set -euo pipefail

REALM=agent-mesh
KC=/opt/keycloak/bin/kcadm.sh
API=http://localhost:8000
KCURL=http://localhost:8080
OUT=proof/web-admin-red-team.txt
AUTH_PY=packages/rag-engine/src/rag_engine/user_auth.py

KC_ADMIN_PW=$(grep '^KEYCLOAK_ADMIN_PASSWORD=' .env | cut -d= -f2-)
PW=$(grep '^DEMO_USER_PASSWORD=' .env | cut -d= -f2-)
AUD=$(python3 - <<PY
import re
m = re.search(r'web_api_audience: str = Field\(default="([^"]+)"', open("packages/core/src/core/settings.py").read())
print(m.group(1) if m else "rag-engine-api")
PY
)

kc() { docker compose exec -T keycloak "$KC" "$@"; }
CID=""
cleanup() {
  [ -n "$CID" ] && kc delete "clients/$CID" -r "$REALM" >/dev/null 2>&1 || true
  unset ALICE_T CAROL_T PW KC_ADMIN_PW
}
trap cleanup EXIT

kc config credentials --server "$KCURL" --realm master --user admin --password "$KC_ADMIN_PW" >/dev/null

# Stale client from a crashed earlier run
for old in $(kc get clients -r "$REALM" -q clientId=redteam-cli --fields id --format csv --noquotes | tr -d '\r'); do
  kc delete "clients/$old" -r "$REALM" >/dev/null
done

CID=$(kc create clients -r "$REALM" -s clientId=redteam-cli -s protocol=openid-connect \
  -s enabled=true -s publicClient=true -s directAccessGrantsEnabled=true \
  -s standardFlowEnabled=false -i | tr -d '\r')

kc create "clients/$CID/protocol-mappers/models" -r "$REALM" -s name=aud \
  -s protocol=openid-connect -s protocolMapper=oidc-audience-mapper \
  -s "config.\"included.custom.audience\"=$AUD" \
  -s 'config."access.token.claim"=true' -s 'config."id.token.claim"=false' >/dev/null
kc create "clients/$CID/protocol-mappers/models" -r "$REALM" -s name=realm-roles \
  -s protocol=openid-connect -s protocolMapper=oidc-usermodel-realm-role-mapper \
  -s 'config."claim.name"=realm_access.roles' -s 'config."multivalued"=true' \
  -s 'config."jsonType.label"=String' -s 'config."access.token.claim"=true' \
  -s 'config."id.token.claim"=false' >/dev/null
kc create "clients/$CID/protocol-mappers/models" -r "$REALM" -s name=sub \
  -s protocol=openid-connect -s protocolMapper=oidc-sub-mapper \
  -s 'config."access.token.claim"=true' -s 'config."id.token.claim"=false' >/dev/null

get_token() {
  curl -s -X POST "$KCURL/realms/$REALM/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=redteam-cli -d username="$1" \
    --data-urlencode "password=$PW" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))'
}
ALICE_T=$(get_token alice)
CAROL_T=$(get_token carol)
[ -n "$ALICE_T" ] && [ -n "$CAROL_T" ] || { echo "FAIL: token not issued"; exit 1; }

# Preflight: does the token carry every claim the backend requires?
ALICE_T="$ALICE_T" python3 - <<PY
import ast, os, sys, json, base64
src = ast.parse(open("$AUTH_PY").read())
req = next(ast.literal_eval(n.value) for n in ast.walk(src)
           if isinstance(n, ast.Assign) and any(getattr(t, "id", "") == "_REQUIRED_CLAIMS" for t in n.targets))
p = os.environ["ALICE_T"].split(".")[1]
claims = json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4)))
missing = [c for c in req if c not in claims]
print("required claims:", list(req))
print("missing in token:", missing or "none")
sys.exit(1 if missing else 0)
PY

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
JSON='Content-Type: application/json'

C_STATUS=$(code "$API/admin/kill-switch/status" -H "Authorization: Bearer $CAROL_T")
A_STATUS=$(code "$API/admin/kill-switch/status" -H "Authorization: Bearer $ALICE_T")
A_ACT=$(code -X POST "$API/admin/kill-switch/activate" -H "Authorization: Bearer $ALICE_T" -H "$JSON" -d '{"reason":"x"}')
A_DEACT=$(code -X POST "$API/admin/kill-switch/deactivate" -H "Authorization: Bearer $ALICE_T")
STATE=$(curl -s "$API/admin/kill-switch/status" -H "Authorization: Bearer $CAROL_T")

# Safety net: if the gate failed, undo the damage
if [ "$A_ACT" = "200" ]; then
  code -X POST "$API/admin/kill-switch/deactivate" -H "Authorization: Bearer $CAROL_T" >/dev/null
fi

{
  echo "== backend gate, $(date -u +%FT%TZ) =="
  echo "carol (platform-admin) GET status      : $C_STATUS  (expect 200)"
  echo "alice (no role)        GET status      : $A_STATUS  (expect 403)"
  echo "alice (no role)        POST activate   : $A_ACT  (expect 403)"
  echo "alice (no role)        POST deactivate : $A_DEACT  (expect 403)"
  echo "kill switch state after                : $STATE  (expect active=false)"
} | tee -a "$OUT"

[ "$C_STATUS" = 200 ] && [ "$A_STATUS" = 403 ] && [ "$A_ACT" = 403 ] && [ "$A_DEACT" = 403 ] \
  && echo "RESULT: PASS" | tee -a "$OUT" \
  || { echo "RESULT: FAIL" | tee -a "$OUT"; exit 1; }
