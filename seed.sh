#!/bin/bash

# HRMS Portal Seeding Script
# This script populates the services with sample data via the API Gateway.
# It outputs a finalized Notion table with actual generated IDs.

GATEWAY_URL="http://localhost:3000/api/v1"

echo "⏳ Waiting for API Gateway to be ready..."
# Corrected loop syntax (removed $() and used GET)
while ! curl -s -f "$GATEWAY_URL/health" > /dev/null; do
    printf '.'
    sleep 2
done
echo -e "\n✅ Gateway is UP!"

# 1. Signup (Tenant + Admin)
echo "👤 Creating Tenant and Admin User..."
SIGNUP_RES=$(curl -s -X POST "$GATEWAY_URL/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantName": "Acme Corporation",
    "name": "Sarah Chen",
    "email": "sarah.admin@acme.com",
    "password": "Password123!"
  }')

TENANT_ID=$(echo $SIGNUP_RES | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)
TOKEN=$(echo $SIGNUP_RES | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ Error: Signup failed. Response: $SIGNUP_RES"
  exit 1
fi

# 2. Add Employees
echo "👥 Adding Sample Employees..."
declare -a EMPLOYEES=(
  '{"firstName":"Michael","lastName":"Scott","email":"michael.mgr@acme.com","department":"Management"}'
  '{"firstName":"Jim","lastName":"Halpert","email":"jim.emp@acme.com","department":"Sales"}'
  '{"firstName":"Pam","lastName":"Beesly","email":"pam.reception@acme.com","department":"Admin"}'
)

for emp in "${EMPLOYEES[@]}"; do
  curl -s -X POST "$GATEWAY_URL/employees" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$emp" > /dev/null
done

# 3. Create Leave Requests
echo "📅 Creating Sample Leave Requests..."
EMP_ID=$(curl -s -H "Authorization: Bearer $TOKEN" "$GATEWAY_URL/employees" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

if [ ! -z "$EMP_ID" ]; then
  curl -s -X POST "$GATEWAY_URL/leave-requests" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"employeeId\": \"$EMP_ID\",
      \"type\": \"ANNUAL\",
      \"startDate\": \"2026-05-10\",
      \"endDate\": \"2026-05-15\",
      \"reason\": \"Family Vacation\"
    }" > /dev/null
fi

# 4. Create Notifications
echo "🔔 Creating Sample Notifications..."
curl -s -X POST "$GATEWAY_URL/notifications" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "EMAIL",
    "title": "Welcome to Acme Corp",
    "body": "Your HR portal is now active. Explore the dashboard to get started.",
    "status": "SENT"
  }' > /dev/null

echo -e "\n\n"
echo "================================================================"
echo "🎉 PROJECT SEEDED SUCCESSFULLY!"
echo "================================================================"
echo ""
echo "📋 NOTION COPY-PASTE TABLE (ACTUAL CREDENTIALS):"
echo ""
echo "| Field | Value |"
| :--- | :--- |
echo "| **Login URL** | http://localhost:5173/login |"
echo "| **Tenant ID** | \`$TENANT_ID\` |"
echo "| **Admin Email** | \`sarah.admin@acme.com\` |"
echo "| **Password** | \`Password123!\` |"
echo ""
echo "⚠️ IMPORTANT: Copy the Tenant ID exactly as shown above (\`$TENANT_ID\`)."
echo "================================================================"
