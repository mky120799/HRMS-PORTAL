provider "aws" {
  region = var.aws_region
}

# -----------------------------------------------------------------------------
# 1. NETWORKING (VPC, Subnets)
# -----------------------------------------------------------------------------
resource "aws_vpc" "hrms_vpc" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = {
    Name = "hrms-${var.environment}-vpc"
  }
}

# Public Subnets (For ALB and NAT Gateway)
resource "aws_subnet" "public_1" {
  vpc_id                  = aws_vpc.hrms_vpc.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = true
  tags = { Name = "hrms-public-1" }
}

resource "aws_subnet" "public_2" {
  vpc_id                  = aws_vpc.hrms_vpc.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = "${var.aws_region}b"
  map_public_ip_on_launch = true
  tags = { Name = "hrms-public-2" }
}

# Private Subnets (For ECS Tasks, RDS, Redis)
resource "aws_subnet" "private_1" {
  vpc_id            = aws_vpc.hrms_vpc.id
  cidr_block        = "10.0.3.0/24"
  availability_zone = "${var.aws_region}a"
  tags = { Name = "hrms-private-1" }
}

resource "aws_subnet" "private_2" {
  vpc_id            = aws_vpc.hrms_vpc.id
  cidr_block        = "10.0.4.0/24"
  availability_zone = "${var.aws_region}b"
  tags = { Name = "hrms-private-2" }
}

# Internet Gateway
resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.hrms_vpc.id
  tags = { Name = "hrms-igw" }
}

# Security Groups
resource "aws_security_group" "alb_sg" {
  name        = "hrms-alb-sg"
  description = "Allow HTTP/HTTPS inbound"
  vpc_id      = aws_vpc.hrms_vpc.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "ecs_sg" {
  name        = "hrms-ecs-sg"
  description = "Allow inbound from ALB"
  vpc_id      = aws_vpc.hrms_vpc.id

  ingress {
    from_port       = 80
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb_sg.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "db_sg" {
  name        = "hrms-db-sg"
  description = "Allow inbound from ECS"
  vpc_id      = aws_vpc.hrms_vpc.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_sg.id]
  }
}

resource "aws_security_group" "redis_sg" {
  name        = "hrms-redis-sg"
  description = "Allow inbound from ECS"
  vpc_id      = aws_vpc.hrms_vpc.id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_sg.id]
  }
}

# -----------------------------------------------------------------------------
# 2. DATABASE (Amazon RDS - PostgreSQL)
# -----------------------------------------------------------------------------
resource "aws_db_instance" "hrms_postgres" {
  identifier           = "hrms-${var.environment}-db"
  allocated_storage    = 20
  engine               = "postgres"
  engine_version       = "16"
  instance_class       = "db.t4g.micro" # Cost-effective for starting, scale up later
  username             = var.db_username
  password             = var.db_password
  skip_final_snapshot  = true
  publicly_accessible  = false
  vpc_security_group_ids = [aws_security_group.db_sg.id]
  db_subnet_group_name = aws_db_subnet_group.default.name
  tags = {
    Name = "hrms-${var.environment}-postgres"
  }
}

resource "aws_db_subnet_group" "default" {
  name       = "hrms-db-subnet-group"
  subnet_ids = [aws_subnet.private_1.id, aws_subnet.private_2.id]
  tags = { Name = "HRMS DB Subnet Group" }
}

# -----------------------------------------------------------------------------
# 3. CACHE & QUEUE (Amazon ElastiCache - Redis)
# -----------------------------------------------------------------------------
resource "aws_elasticache_cluster" "hrms_redis" {
  cluster_id           = "hrms-${var.environment}-redis"
  engine               = "redis"
  node_type            = "cache.t4g.micro"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.default.name
  security_group_ids   = [aws_security_group.redis_sg.id]
}

resource "aws_elasticache_subnet_group" "default" {
  name       = "hrms-redis-subnet-group"
  subnet_ids = [aws_subnet.private_1.id, aws_subnet.private_2.id]
}

# -----------------------------------------------------------------------------
# 4. STORAGE (Amazon S3 - For Resumes)
# -----------------------------------------------------------------------------
resource "aws_s3_bucket" "hrms_resumes" {
  bucket = var.s3_bucket_name
  tags = {
    Name = "HRMS Resumes Storage"
  }
}

# Make bucket private
resource "aws_s3_bucket_public_access_block" "resumes_private" {
  bucket                  = aws_s3_bucket.hrms_resumes.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# -----------------------------------------------------------------------------
# 5. EMAILS (Amazon SES)
# -----------------------------------------------------------------------------
resource "aws_ses_domain_identity" "hrms_email" {
  domain = var.domain_name
}

# -----------------------------------------------------------------------------
# 6. COMPUTE (Amazon ECS Fargate)
# -----------------------------------------------------------------------------
resource "aws_ecs_cluster" "hrms_cluster" {
  name = "hrms-${var.environment}-cluster"
}

# Note: ECS Task Definitions and Services should ideally be deployed via GitHub Actions
# to ensure CI/CD pipeline handles image tags properly. This cluster serves as the target.

# -----------------------------------------------------------------------------
# 7. LOAD BALANCER (ALB)
# -----------------------------------------------------------------------------
resource "aws_lb" "hrms_alb" {
  name               = "hrms-${var.environment}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb_sg.id]
  subnets            = [aws_subnet.public_1.id, aws_subnet.public_2.id]
}

resource "aws_lb_target_group" "hrms_web_tg" {
  name        = "hrms-web-tg"
  port        = 80
  protocol    = "HTTP"
  vpc_id      = aws_vpc.hrms_vpc.id
  target_type = "ip"

  health_check {
    path                = "/"
    healthy_threshold   = 3
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
  }
}

resource "aws_lb_listener" "http_listener" {
  load_balancer_arn = aws_lb.hrms_alb.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.hrms_web_tg.arn
  }
}
