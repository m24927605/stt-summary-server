# ──────────────────────────────────────────
# CloudWatch Log Groups
# ──────────────────────────────────────────

resource "aws_cloudwatch_log_group" "server" {
  name              = "/ecs/${var.project_name}/server"
  retention_in_days = 14

  tags = { Name = "${var.project_name}-server-logs" }
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/${var.project_name}/worker"
  retention_in_days = 14

  tags = { Name = "${var.project_name}-worker-logs" }
}

resource "aws_cloudwatch_log_group" "frontend" {
  name              = "/ecs/${var.project_name}/frontend"
  retention_in_days = 14

  tags = { Name = "${var.project_name}-frontend-logs" }
}
