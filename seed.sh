#!/bin/bash

# HRMS Portal Seeding Script
# This script populates the services with sample data via the API Gateway.

GATEWAY_URL="http://localhost:3000/api/v1"

echo "⏳ Waiting for API Gateway to be ready..."
until $(curl --output /dev/null --silent --head --fail $GATEWAY_URL/health); do
    printf '.'
    sleep 2
done
echo "✅ Gateway is UP!"

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

echo "✅ Created Tenant: $TENANT_ID"

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
echo "✅ Added 3 Employees."

# 3. Create Leave Requests
echo "📅 Creating Sample Leave Requests..."
# First we need an employee ID. We'll just fetch them all and take the first one.
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
  echo "✅ Added Leave Request for Employee $EMP_ID."
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

echo "🎉 Seeding Complete! You can now log in with sarah.admin@acme.com / Password123!"
