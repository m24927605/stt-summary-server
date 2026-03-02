# ──────────────────────────────────────────
# ECS Cluster
# ──────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = "${var.project_name}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Name = "${var.project_name}-cluster" }
}

# ──────────────────────────────────────────
# Composed connection URLs
# ──────────────────────────────────────────

locals {
  database_url = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.postgres.endpoint}/${var.db_name}"
}

# ──────────────────────────────────────────
# Server Task Definition
# ──────────────────────────────────────────

resource "aws_ecs_task_definition" "server" {
  family                   = "${var.project_name}-server"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.server_cpu
  memory                   = var.server_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name  = "server"
    image = var.server_image

    repositoryCredentials = {
      credentialsParameter = aws_secretsmanager_secret.ghcr_credentials.arn
    }

    portMappings = [{
      containerPort = 3000
      protocol      = "tcp"
    }]

    environment = [
      { name = "SERVER_PORT", value = "3000" },
      { name = "CORS_ORIGIN", value = "http://${aws_lb.main.dns_name}" },
      { name = "S3_ENDPOINT", value = "" },
      { name = "S3_BUCKET", value = aws_s3_bucket.uploads.id },
      { name = "S3_REGION", value = var.aws_region },
    ]

    secrets = [
      { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
      { name = "RABBITMQ_URL", valueFrom = aws_secretsmanager_secret.rabbitmq_url.arn },
      { name = "S3_ACCESS_KEY_ID", valueFrom = "${aws_secretsmanager_secret.s3_credentials.arn}:access_key_id::" },
      { name = "S3_SECRET_ACCESS_KEY", valueFrom = "${aws_secretsmanager_secret.s3_credentials.arn}:secret_access_key::" },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.server.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "server"
      }
    }

    essential = true
  }])

  tags = { Name = "${var.project_name}-server-task" }
}

# ──────────────────────────────────────────
# Worker Task Definition
# ──────────────────────────────────────────

resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.project_name}-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.worker_cpu
  memory                   = var.worker_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name  = "worker"
    image = var.worker_image

    repositoryCredentials = {
      credentialsParameter = aws_secretsmanager_secret.ghcr_credentials.arn
    }

    environment = [
      { name = "WHISPER_MODEL", value = var.whisper_model },
      { name = "GPT_MODEL", value = var.gpt_model },
      { name = "S3_ENDPOINT", value = "" },
      { name = "S3_BUCKET", value = aws_s3_bucket.uploads.id },
      { name = "S3_REGION", value = var.aws_region },
    ]

    secrets = [
      { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
      { name = "RABBITMQ_URL", valueFrom = aws_secretsmanager_secret.rabbitmq_url.arn },
      { name = "OPENAI_API_KEY", valueFrom = aws_secretsmanager_secret.openai_api_key.arn },
      { name = "S3_ACCESS_KEY_ID", valueFrom = "${aws_secretsmanager_secret.s3_credentials.arn}:access_key_id::" },
      { name = "S3_SECRET_ACCESS_KEY", valueFrom = "${aws_secretsmanager_secret.s3_credentials.arn}:secret_access_key::" },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.worker.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "worker"
      }
    }

    essential = true
  }])

  tags = { Name = "${var.project_name}-worker-task" }
}

# ──────────────────────────────────────────
# Frontend Task Definition
# ──────────────────────────────────────────

resource "aws_ecs_task_definition" "frontend" {
  family                   = "${var.project_name}-frontend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.frontend_cpu
  memory                   = var.frontend_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn

  container_definitions = jsonencode([{
    name  = "frontend"
    image = var.frontend_image

    repositoryCredentials = {
      credentialsParameter = aws_secretsmanager_secret.ghcr_credentials.arn
    }

    portMappings = [{
      containerPort = 8080
      protocol      = "tcp"
    }]

    environment = [
      { name = "API_HOST", value = "localhost" },
      { name = "API_PORT", value = "3000" },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.frontend.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "frontend"
      }
    }

    essential = true
  }])

  tags = { Name = "${var.project_name}-frontend-task" }
}

# ──────────────────────────────────────────
# ECS Services
# ──────────────────────────────────────────

resource "aws_ecs_service" "server" {
  name            = "${var.project_name}-server"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.server.arn
  desired_count   = var.server_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.server.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.server.arn
    container_name   = "server"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener.http]

  tags = { Name = "${var.project_name}-server-svc" }
}

resource "aws_ecs_service" "worker" {
  name            = "${var.project_name}-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.worker_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.worker.id]
    assign_public_ip = false
  }

  tags = { Name = "${var.project_name}-worker-svc" }
}

resource "aws_ecs_service" "frontend" {
  name            = "${var.project_name}-frontend"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.frontend.arn
  desired_count   = var.frontend_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.frontend.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.frontend.arn
    container_name   = "frontend"
    container_port   = 8080
  }

  depends_on = [aws_lb_listener.http]

  tags = { Name = "${var.project_name}-frontend-svc" }
}
