# ──────────────────────────────────────────
# Secrets Manager
# ──────────────────────────────────────────

# Database URL (composed from RDS endpoint)
resource "aws_secretsmanager_secret" "database_url" {
  name = "${var.project_name}/database-url"

  tags = { Name = "${var.project_name}-database-url" }
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = local.database_url
}

# RabbitMQ URL (composed from Amazon MQ endpoint)
resource "aws_secretsmanager_secret" "rabbitmq_url" {
  name = "${var.project_name}/rabbitmq-url"

  tags = { Name = "${var.project_name}-rabbitmq-url" }
}

resource "aws_secretsmanager_secret_version" "rabbitmq_url" {
  secret_id     = aws_secretsmanager_secret.rabbitmq_url.id
  secret_string = local.rabbitmq_url
}

# OpenAI API Key
resource "aws_secretsmanager_secret" "openai_api_key" {
  name = "${var.project_name}/openai-api-key"

  tags = { Name = "${var.project_name}-openai-api-key" }
}

resource "aws_secretsmanager_secret_version" "openai_api_key" {
  secret_id     = aws_secretsmanager_secret.openai_api_key.id
  secret_string = var.openai_api_key
}

# API Key (for authenticating API requests)
resource "aws_secretsmanager_secret" "api_key" {
  name = "${var.project_name}/api-key"

  tags = { Name = "${var.project_name}-api-key" }
}

resource "aws_secretsmanager_secret_version" "api_key" {
  secret_id     = aws_secretsmanager_secret.api_key.id
  secret_string = var.api_key
}

# GHCR Credentials (for pulling private Docker images)
resource "aws_secretsmanager_secret" "ghcr_credentials" {
  name = "${var.project_name}/ghcr-credentials"

  tags = { Name = "${var.project_name}-ghcr-credentials" }
}

resource "aws_secretsmanager_secret_version" "ghcr_credentials" {
  secret_id = aws_secretsmanager_secret.ghcr_credentials.id
  secret_string = jsonencode({
    username = var.ghcr_username
    password = var.ghcr_token
  })
}
