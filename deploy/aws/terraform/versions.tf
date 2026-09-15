terraform {
  required_version = ">= 1.10" # the S3 backend's `use_lockfile` below needs 1.10

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State lives on your machine until you say otherwise. For a team, keep it in
  # S3 instead: create a bucket (versioned, encrypted, private), then uncomment
  # this block, fill in the bucket, and run `terraform init -migrate-state`.
  #
  # backend "s3" {
  #   bucket       = "CHANGE-ME-terraform-state"
  #   key          = "ac-graph/terraform.tfstate"
  #   region       = "us-east-1"
  #   encrypt      = true
  #   use_lockfile = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge(
      {
        Project   = var.project_name
        ManagedBy = "terraform"
        Source    = "deploy/aws/terraform"
      },
      var.tags,
    )
  }
}
