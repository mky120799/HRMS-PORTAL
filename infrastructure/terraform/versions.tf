terraform {
  required_version = ">= 1.6"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.60" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }

  # Remote state with locking. Create the bucket/table once, then:
  #   terraform init -backend-config=backend.hcl
  # backend.hcl: bucket = "...", key = "hrms/production.tfstate", region = "...", dynamodb_table = "..."
  backend "s3" {
    encrypt = true
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = { Project = "hrms", Environment = var.environment, ManagedBy = "terraform" }
  }
}

locals {
  name = "hrms-${var.environment}"
  azs  = ["${var.aws_region}a", "${var.aws_region}b"]
}
