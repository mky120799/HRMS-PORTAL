#!/usr/bin/env bash
# Zero-downtime release to ECS for an image tag that is already in ECR.
#
#   ENVIRONMENT=production IMAGE_TAG=<git-sha> ./infrastructure/scripts/deploy.sh
#
# 1. Register new task-definition revisions (server, web, migrate) pointing at IMAGE_TAG.
# 2. Run database migrations as a one-off task and abort the release if they fail.
# 3. Roll the services; ECS keeps old tasks serving until new ones pass health checks,
#    and the deployment circuit breaker rolls back automatically on failure.
set -euo pipefail

: "${IMAGE_TAG:?IMAGE_TAG is required}"
ENVIRONMENT="${ENVIRONMENT:-production}"
NAME="hrms-${ENVIRONMENT}"
CLUSTER="${NAME}-cluster"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION=$(aws configure get region || echo "${AWS_REGION}")
REGISTRY="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

register_revision() { # family, repo → prints new task definition ARN
  local family=$1 repo=$2
  aws ecs describe-task-definition --task-definition "$family" --query taskDefinition --output json |
    jq --arg img "${REGISTRY}/${repo}:${IMAGE_TAG}" '
      .containerDefinitions[0].image = $img
      | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)' \
    > /tmp/td-${family}.json
  aws ecs register-task-definition --cli-input-json "file:///tmp/td-${family}.json" --query taskDefinition.taskDefinitionArn --output text
}

echo "▶ Registering task definitions for ${IMAGE_TAG}"
SERVER_TD=$(register_revision "${NAME}-server" hrms-server)
WEB_TD=$(register_revision "${NAME}-web" hrms-web)
MIGRATE_TD=$(register_revision "${NAME}-migrate" hrms-server)

echo "▶ Running database migrations"
SUBNETS=$(aws ec2 describe-subnets --filters "Name=tag:Name,Values=${NAME}-private-*" --query 'Subnets[].SubnetId' --output text | tr '\t' ',')
SG=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=${NAME}-app" --query 'SecurityGroups[0].GroupId' --output text)
TASK_ARN=$(aws ecs run-task --cluster "$CLUSTER" --launch-type FARGATE --task-definition "$MIGRATE_TD" \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNETS}],securityGroups=[${SG}],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN"
EXIT_CODE=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" --query 'tasks[0].containers[0].exitCode' --output text)
if [ "$EXIT_CODE" != "0" ]; then
  echo "✖ Migrations failed (exit ${EXIT_CODE}). Services were NOT updated. Check CloudWatch /ecs/${NAME}/server (stream prefix: migrate)."
  exit 1
fi

echo "▶ Rolling out services"
aws ecs update-service --cluster "$CLUSTER" --service hrms-server --task-definition "$SERVER_TD" > /dev/null
aws ecs update-service --cluster "$CLUSTER" --service hrms-web --task-definition "$WEB_TD" > /dev/null
aws ecs wait services-stable --cluster "$CLUSTER" --services hrms-server hrms-web
echo "✔ Deployed ${IMAGE_TAG}"
