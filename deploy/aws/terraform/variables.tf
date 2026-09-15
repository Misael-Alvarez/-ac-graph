# ---------------------------------------------------------------------------
# Where and what
# ---------------------------------------------------------------------------

variable "aws_region" {
  description = "Region for everything in this stack."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Prefix for every resource name. Lower-case letters, digits and hyphens."
  type        = string
  default     = "ac-graph"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}$", var.project_name))
    error_message = "Use 2–31 lower-case letters, digits or hyphens, starting with a letter."
  }
}

variable "tags" {
  description = "Extra tags for every resource (Owner, CostCenter, …)."
  type        = map(string)
  default     = {}
}

# ---------------------------------------------------------------------------
# The address people type. HTTPS is not optional: the session cookie is
# marked Secure whenever APP_URL starts with https, and the browser will
# refuse it over plain http.
# ---------------------------------------------------------------------------

variable "domain_name" {
  description = "Public host name of the app, e.g. graph.example.com. APP_URL becomes https://<domain_name>."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9.-]+\\.[a-z]{2,}$", var.domain_name))
    error_message = "domain_name must be a bare host name such as graph.example.com (no scheme, no path)."
  }
}

variable "hosted_zone_id" {
  description = <<-EOT
    Route 53 hosted zone that owns domain_name. When set, the stack issues the
    TLS certificate (DNS-validated) and creates the A record pointing at the
    load balancer. Leave empty if DNS lives elsewhere: then set certificate_arn
    and create the CNAME to the load balancer yourself (see outputs).
  EOT
  type        = string
  default     = ""
}

variable "certificate_arn" {
  description = "ARN of an ACM certificate for domain_name in this region. Required when hosted_zone_id is empty; ignored otherwise."
  type        = string
  default     = ""

  validation {
    condition     = var.certificate_arn == "" || can(regex("^arn:aws:acm:", var.certificate_arn))
    error_message = "certificate_arn must be an ACM certificate ARN."
  }
}

# ---------------------------------------------------------------------------
# The application
# ---------------------------------------------------------------------------

variable "image_tag" {
  description = "Tag of the image in the stack's ECR repository that the first deployment runs. GitHub Actions replaces it with each commit's SHA afterwards."
  type        = string
  default     = "latest"
}

variable "container_cpu" {
  description = "Fargate CPU units for the task (256 = ¼ vCPU). 512 is comfortable for a small team."
  type        = number
  default     = 512
}

variable "container_memory" {
  description = "Fargate memory in MiB. Password hashing uses ~32 MiB per attempt; 1024 leaves room."
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "How many copies of the app run. Two survive a task failure without a blip; one is enough to start."
  type        = number
  default     = 1
}

variable "auth_signup" {
  description = "Whether the sign-in page may create accounts: open (anyone who reaches the URL) or closed (accounts are made with `npm run users`). Start open, close it once the team is in."
  type        = string
  default     = "open"

  validation {
    condition     = contains(["open", "closed"], var.auth_signup)
    error_message = "auth_signup must be open or closed."
  }
}

variable "session_ttl_hours" {
  description = "How long a sign-in lasts."
  type        = number
  default     = 12
}

variable "anthropic_api_key" {
  description = "Optional. Enables the AI features. Stored in Secrets Manager, never in the task definition."
  type        = string
  default     = ""
  sensitive   = true
}

variable "metrics_token" {
  description = "Optional. When set, /api/metrics demands `Authorization: Bearer <token>`. Leave empty to keep metrics unauthenticated behind the load balancer (they carry no personal data)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "log_retention_days" {
  description = "How long CloudWatch keeps the application logs."
  type        = number
  default     = 30
}

# ---------------------------------------------------------------------------
# The database
# ---------------------------------------------------------------------------

variable "db_instance_class" {
  description = "RDS instance class. db.t4g.micro is the cheapest that works and is plenty for a team."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Storage in GiB (gp3). Diagrams are small; 20 goes a long way."
  type        = number
  default     = 20
}

variable "db_engine_version" {
  description = "PostgreSQL major version. The app is tested against 17."
  type        = string
  default     = "17"
}

variable "db_backup_retention_days" {
  description = "Automated backups kept, in days."
  type        = number
  default     = 7
}

variable "db_deletion_protection" {
  description = "Refuse `terraform destroy` of the database while true. Turn off only on purpose."
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# Deployments from GitHub Actions (optional but recommended)
# ---------------------------------------------------------------------------

variable "github_repository" {
  description = "owner/name of the GitHub repository allowed to deploy, e.g. Misael-Alvarez/-ac-graph. Empty disables the OIDC role."
  type        = string
  default     = ""
}

variable "github_branch" {
  description = "Branch whose pushes may deploy."
  type        = string
  default     = "main"
}
