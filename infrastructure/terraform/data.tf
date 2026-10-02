# ─── PostgreSQL (RDS) ─────────────────────────────────────────────────────────
resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "main" {
  name   = "${local.name}-pg16"
  family = "postgres16"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "500" # log queries slower than 500 ms
  }
}

resource "aws_db_instance" "main" {
  identifier                   = "${local.name}-db"
  engine                       = "postgres"
  engine_version               = "16"
  instance_class               = var.db_instance_class
  allocated_storage            = 20
  max_allocated_storage        = 200 # storage autoscaling
  storage_type                 = "gp3"
  storage_encrypted            = true
  db_name                      = "hrms"
  username                     = var.db_username
  password                     = random_password.db.result
  multi_az                     = var.db_multi_az
  db_subnet_group_name         = aws_db_subnet_group.main.name
  vpc_security_group_ids       = [aws_security_group.db.id]
  parameter_group_name         = aws_db_parameter_group.main.name
  publicly_accessible          = false
  backup_retention_period      = 14
  backup_window                = "20:00-21:00"
  maintenance_window           = "sun:21:30-sun:22:30"
  copy_tags_to_snapshot        = true
  deletion_protection          = true
  skip_final_snapshot          = false
  final_snapshot_identifier    = "${local.name}-db-final"
  performance_insights_enabled = true
  auto_minor_version_upgrade   = true
}

# ─── RabbitMQ (Amazon MQ) — durable background work ──────────────────────────
resource "random_password" "rabbitmq" {
  length  = 32
  special = false
}

resource "aws_mq_broker" "main" {
  broker_name                = "${local.name}-rabbitmq"
  engine_type                = "RabbitMQ"
  engine_version             = "4.3"
  host_instance_type         = var.rabbitmq_instance_type
  deployment_mode            = "CLUSTER_MULTI_AZ"
  publicly_accessible        = false
  auto_minor_version_upgrade = true
  subnet_ids                 = aws_subnet.private[*].id
  security_groups            = [aws_security_group.rabbitmq.id]

  logs {
    general = true
  }

  encryption_options {
    use_aws_owned_key = true
  }

  user {
    username = "hrms"
    password = random_password.rabbitmq.result
  }
}

# ─── S3 — private documents & resumes ─────────────────────────────────────────
resource "aws_s3_bucket" "files" {
  bucket = var.s3_bucket_name
}

resource "aws_s3_bucket_public_access_block" "files" {
  bucket                  = aws_s3_bucket.files.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "files" {
  bucket = aws_s3_bucket.files.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "files" {
  bucket = aws_s3_bucket.files.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "files" {
  bucket = aws_s3_bucket.files.id
  versioning_configuration {
    status = "Enabled" # protects against accidental deletes/overwrites
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "files" {
  bucket = aws_s3_bucket.files.id
  rule {
    id     = "expire-deleted-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30 # erasure requests complete within 30 days
    }
  }
}

resource "aws_s3_bucket_policy" "files_tls_only" {
  bucket = aws_s3_bucket.files.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.files.arn, "${aws_s3_bucket.files.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

# ─── SES ──────────────────────────────────────────────────────────────────────
resource "aws_ses_domain_identity" "main" {
  domain = var.email_domain
}

resource "aws_ses_domain_dkim" "main" {
  domain = aws_ses_domain_identity.main.domain
}
