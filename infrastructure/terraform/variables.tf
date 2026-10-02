variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "ap-south-1"
}

variable "environment" {
  description = "Environment name (production, staging)"
  type        = string
  default     = "production"
}

variable "domain_name" {
  description = "Public hostname of the app, e.g. hr.example.com (must match the ACM certificate)"
  type        = string
}

variable "acm_certificate_arn" {
  description = "ARN of an issued ACM certificate for domain_name (same region)"
  type        = string
}

variable "email_domain" {
  description = "Domain used as the email sender (verified in SES)"
  type        = string
}

variable "s3_bucket_name" {
  description = "Globally unique name of the private file bucket (documents, resumes)"
  type        = string
}

variable "db_username" {
  type    = string
  default = "hrmsadmin"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.small"
}

variable "db_multi_az" {
  description = "Standby replica in a second AZ (recommended for production)"
  type        = bool
  default     = true
}

variable "rabbitmq_instance_type" {
  description = "Amazon MQ RabbitMQ node size; mq.m7g.large is the production baseline"
  type        = string
  default     = "mq.m7g.large"
}

variable "redis_node_type" {
  description = "ElastiCache node size; cache.t4g.micro is plenty for rate-limit counters"
  type        = string
  default     = "cache.t4g.micro"
}

variable "redis_nodes" {
  description = "1 = single node; 2 = primary + replica with automatic failover (recommended for production)"
  type        = number
  default     = 2
}

variable "server_desired_count" {
  type    = number
  default = 2
}

variable "web_desired_count" {
  type    = number
  default = 2
}

variable "image_tag" {
  description = "Initial image tag for task definitions. CI deploys later revisions."
  type        = string
  default     = "latest"
}

variable "alarm_email" {
  description = "Email that receives CloudWatch alarm notifications"
  type        = string
}
