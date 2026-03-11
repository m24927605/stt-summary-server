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

# S3 Credentials (IAM user access key)
resource "aws_secretsmanager_secret" "s3_credentials" {
  name = "${var.project_name}/s3-credentials"

  tags = { Name = "${var.project_name}-s3-credentials" }
}

resource "aws_secretsmanager_secret_version" "s3_credentials" {
  secret_id = aws_secretsmanager_secret.s3_credentials.id
  secret_string = jsonencode({
    access_key_id     = aws_iam_access_key.s3_user.id
    secret_access_key = aws_iam_access_key.s3_user.secret
  })
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
