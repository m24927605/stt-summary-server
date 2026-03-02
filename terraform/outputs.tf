# ──────────────────────────────────────────
# Outputs
# ──────────────────────────────────────────

output "alb_url" {
  description = "Application URL (ALB DNS)"
  value       = "http://${aws_lb.main.dns_name}"
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint"
  value       = aws_db_instance.postgres.endpoint
}

output "mq_console_url" {
  description = "Amazon MQ RabbitMQ management console URL"
  value       = aws_mq_broker.rabbitmq.instances[0].console_url
}

output "s3_bucket_name" {
  description = "S3 bucket for audio uploads"
  value       = aws_s3_bucket.uploads.id
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}
