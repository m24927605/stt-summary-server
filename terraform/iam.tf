# ──────────────────────────────────────────
# ECS Task Execution Role
# Used by ECS agent to pull images and fetch secrets
# ──────────────────────────────────────────

resource "aws_iam_role" "ecs_execution" {
  name = "${var.project_name}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })

  tags = { Name = "${var.project_name}-ecs-execution" }
}

resource "aws_iam_role_policy_attachment" "ecs_execution_basic" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "secrets-access"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      Resource = [
        aws_secretsmanager_secret.database_url.arn,
        aws_secretsmanager_secret.rabbitmq_url.arn,
        aws_secretsmanager_secret.openai_api_key.arn,
        aws_secretsmanager_secret.api_key.arn,
        aws_secretsmanager_secret.ghcr_credentials.arn,
      ]
    }]
  })
}

# ──────────────────────────────────────────
# Server Task Role
# Runtime permissions for the server container
# Server only needs to upload files to S3
# ──────────────────────────────────────────

resource "aws_iam_role" "ecs_task_server" {
  name = "${var.project_name}-ecs-task-server"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })

  tags = { Name = "${var.project_name}-ecs-task-server" }
}

resource "aws_iam_role_policy" "ecs_task_server_s3" {
  name = "s3-put-only"
  role = aws_iam_role.ecs_task_server.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject"]
      Resource = "${aws_s3_bucket.uploads.arn}/*"
    }]
  })
}

# ──────────────────────────────────────────
# Worker Task Role
# Runtime permissions for the worker container
# Worker only needs to download files from S3
# ──────────────────────────────────────────

resource "aws_iam_role" "ecs_task_worker" {
  name = "${var.project_name}-ecs-task-worker"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })

  tags = { Name = "${var.project_name}-ecs-task-worker" }
}

resource "aws_iam_role_policy" "ecs_task_worker_s3" {
  name = "s3-get-only"
  role = aws_iam_role.ecs_task_worker.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject"]
      Resource = "${aws_s3_bucket.uploads.arn}/*"
    }]
  })
}
