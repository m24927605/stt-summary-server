# ──────────────────────────────────────────
# General
# ──────────────────────────────────────────

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-northeast-1"
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "stt-summary"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "production"
}

# ──────────────────────────────────────────
# VPC
# ──────────────────────────────────────────

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "Public subnet CIDR blocks (one per AZ)"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  description = "Private subnet CIDR blocks (one per AZ)"
  type        = list(string)
  default     = ["10.0.10.0/24", "10.0.11.0/24"]
}

variable "availability_zones" {
  description = "Availability zones"
  type        = list(string)
  default     = ["ap-northeast-1a", "ap-northeast-1c"]
}

# ──────────────────────────────────────────
# ECS
# ──────────────────────────────────────────

variable "server_cpu" {
  description = "Server task CPU units (1 vCPU = 1024)"
  type        = number
  default     = 256
}

variable "server_memory" {
  description = "Server task memory in MB"
  type        = number
  default     = 512
}

variable "worker_cpu" {
  description = "Worker task CPU units"
  type        = number
  default     = 256
}

variable "worker_memory" {
  description = "Worker task memory in MB"
  type        = number
  default     = 512
}

variable "frontend_cpu" {
  description = "Frontend task CPU units"
  type        = number
  default     = 256
}

variable "frontend_memory" {
  description = "Frontend task memory in MB"
  type        = number
  default     = 512
}

variable "server_desired_count" {
  description = "Number of server tasks"
  type        = number
  default     = 1
}

variable "worker_desired_count" {
  description = "Number of worker tasks"
  type        = number
  default     = 1
}

variable "frontend_desired_count" {
  description = "Number of frontend tasks"
  type        = number
  default     = 1
}

# ──────────────────────────────────────────
# Container Images (GHCR)
# ──────────────────────────────────────────

variable "server_image" {
  description = "Server Docker image URI"
  type        = string
  default     = "ghcr.io/m24927605/stt-summary-server/server:latest"
}

variable "worker_image" {
  description = "Worker Docker image URI"
  type        = string
  default     = "ghcr.io/m24927605/stt-summary-server/worker:latest"
}

variable "frontend_image" {
  description = "Frontend Docker image URI"
  type        = string
  default     = "ghcr.io/m24927605/stt-summary-server/frontend:latest"
}

variable "ghcr_username" {
  description = "GitHub username for GHCR authentication"
  type        = string
}

variable "ghcr_token" {
  description = "GitHub PAT with read:packages scope"
  type        = string
  sensitive   = true
}

# ──────────────────────────────────────────
# RDS
# ──────────────────────────────────────────

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "stt_summary"
}

variable "db_username" {
  description = "Database master username"
  type        = string
  default     = "postgres"
}

variable "db_password" {
  description = "Database master password"
  type        = string
  sensitive   = true
}

# ──────────────────────────────────────────
# Amazon MQ (RabbitMQ)
# ──────────────────────────────────────────

variable "mq_instance_type" {
  description = "Amazon MQ instance type"
  type        = string
  default     = "mq.t3.micro"
}

variable "mq_username" {
  description = "RabbitMQ admin username"
  type        = string
  default     = "admin"
}

variable "mq_password" {
  description = "RabbitMQ admin password"
  type        = string
  sensitive   = true
}

# ──────────────────────────────────────────
# OpenAI
# ──────────────────────────────────────────

variable "domain_name" {
  description = "Domain name for the application"
  type        = string
  default     = "voicebrief.xyz"
}

variable "openai_api_key" {
  description = "OpenAI API key"
  type        = string
  sensitive   = true
}

variable "whisper_model" {
  description = "OpenAI Whisper model name"
  type        = string
  default     = "whisper-1"
}

variable "gpt_model" {
  description = "OpenAI GPT model name"
  type        = string
  default     = "gpt-4o"
}
