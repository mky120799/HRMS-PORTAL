variable "aws_region" {
  description = "The AWS region to deploy into"
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (e.g., production, staging)"
  default     = "production"
}

variable "db_password" {
  description = "Password for the RDS PostgreSQL database"
  type        = string
  sensitive   = true
}

variable "db_username" {
  description = "Username for the RDS PostgreSQL database"
  default     = "hrmsadmin"
}

variable "domain_name" {
  description = "The domain name for SES verification (e.g., yourcompany.com)"
  type        = string
}

variable "s3_bucket_name" {
  description = "Name of the S3 bucket for HRMS resumes"
  type        = string
}
