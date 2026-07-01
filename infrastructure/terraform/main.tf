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
  tags = {
    Name = "hrms-${var.environment}-postgres"
  }
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
