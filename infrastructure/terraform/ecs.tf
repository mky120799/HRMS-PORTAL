resource "aws_ecr_repository" "server" {
  name                 = "hrms-server"
  image_tag_mutability = "IMMUTABLE" # a tag always means the same build
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "web" {
  name                 = "hrms-web"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "keep_recent" {
  for_each   = { server = aws_ecr_repository.server.name, web = aws_ecr_repository.web.name }
  repository = each.value
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 30 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 30 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_ecs_cluster" "main" {
  name = "${local.name}-cluster"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "server" {
  name              = "/ecs/${local.name}/server"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${local.name}/web"
  retention_in_days = 30
}

locals {
  app_secret = aws_secretsmanager_secret.app.arn
  int_secret = aws_secretsmanager_secret.integrations.arn

  server_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = "3000" },
    { name = "TRUST_PROXY", value = "true" },
    { name = "FRONTEND_URL", value = "https://${var.domain_name}" },
    { name = "CORS_ORIGINS", value = "https://${var.domain_name}" },
    { name = "STORAGE_DRIVER", value = "s3" },
    { name = "AWS_REGION", value = var.aws_region },
    { name = "AWS_S3_BUCKET_NAME", value = aws_s3_bucket.files.bucket },
    { name = "EMAIL_DRIVER", value = "ses" },
    { name = "EMAIL_FROM", value = "HRMS <noreply@${var.email_domain}>" },
    { name = "GOOGLE_CALLBACK_URL", value = "https://${var.domain_name}/api/v1/auth/google/callback" },
  ]

  server_secrets = concat(
    [for k in ["DATABASE_URL", "JWT_SECRET", "ENCRYPTION_KEY", "RABBITMQ_URL"] : { name = k, valueFrom = "${local.app_secret}:${k}::" }],
    [for k in ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_BASIC", "STRIPE_PRICE_BUSINESS", "STRIPE_PRICE_ENTERPRISE", "GEMINI_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SENTRY_DSN"] :
    { name = k, valueFrom = "${local.int_secret}:${k}::" }],
  )

  log_config = {
    logDriver = "awslogs"
    options = {
      awslogs-group         = aws_cloudwatch_log_group.server.name
      awslogs-region        = var.aws_region
      awslogs-stream-prefix = "server"
    }
  }
}

resource "aws_ecs_task_definition" "server" {
  family                   = "${local.name}-server"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
  depends_on = [aws_secretsmanager_secret_version.app, aws_secretsmanager_secret_version.integrations]
  container_definitions = jsonencode([{
    name             = "server"
    image            = "${aws_ecr_repository.server.repository_url}:${var.image_tag}"
    essential        = true
    portMappings     = [{ containerPort = 3000, protocol = "tcp" }]
    environment      = local.server_environment
    secrets          = local.server_secrets
    logConfiguration = local.log_config
    stopTimeout      = 30 # let in-flight requests and queue jobs drain on deploy
    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://127.0.0.1:3000/api/v1/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }])
}

# One-off task that applies database migrations before each deploy (see infrastructure/scripts/deploy.sh).
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  depends_on               = [aws_secretsmanager_secret_version.app]
  container_definitions = jsonencode([{
    name             = "migrate"
    image            = "${aws_ecr_repository.server.repository_url}:${var.image_tag}"
    essential        = true
    command          = ["npx", "prisma", "migrate", "deploy"]
    secrets          = [{ name = "DATABASE_URL", valueFrom = "${local.app_secret}:DATABASE_URL::" }]
    logConfiguration = merge(local.log_config, { options = merge(local.log_config.options, { awslogs-stream-prefix = "migrate" }) })
  }])
}

resource "aws_ecs_task_definition" "web" {
  family                   = "${local.name}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  container_definitions = jsonencode([{
    name         = "web"
    image        = "${aws_ecr_repository.web.repository_url}:${var.image_tag}"
    essential    = true
    portMappings = [{ containerPort = 8080, protocol = "tcp" }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.web.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "web"
      }
    }
  }])
}

resource "aws_ecs_service" "server" {
  name                               = "hrms-server"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.server.arn
  desired_count                      = var.server_desired_count
  launch_type                        = "FARGATE"
  health_check_grace_period_seconds  = 60
  deployment_minimum_healthy_percent = 100 # rolling deploys never drop capacity
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true # a release that fails health checks rolls back automatically
  }
  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.server.arn
    container_name   = "server"
    container_port   = 3000
  }
  lifecycle {
    ignore_changes = [task_definition, desired_count] # CI deploys revisions; autoscaling owns the count
  }
  depends_on = [aws_lb_listener.https]
}

resource "aws_ecs_service" "web" {
  name                               = "hrms-web"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.web.arn
  desired_count                      = var.web_desired_count
  launch_type                        = "FARGATE"
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 8080
  }
  lifecycle {
    ignore_changes = [task_definition]
  }
  depends_on = [aws_lb_listener.https]
}

resource "aws_appautoscaling_target" "server" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.server.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.server_desired_count
  max_capacity       = 10
}

resource "aws_appautoscaling_policy" "server_cpu" {
  name               = "${local.name}-server-cpu"
  service_namespace  = aws_appautoscaling_target.server.service_namespace
  resource_id        = aws_appautoscaling_target.server.resource_id
  scalable_dimension = aws_appautoscaling_target.server.scalable_dimension
  policy_type        = "TargetTrackingScaling"
  target_tracking_scaling_policy_configuration {
    target_value = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
