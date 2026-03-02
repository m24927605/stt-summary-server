# ──────────────────────────────────────────
# Amazon MQ for RabbitMQ
# ──────────────────────────────────────────

resource "aws_mq_broker" "rabbitmq" {
  broker_name = "${var.project_name}-mq"

  engine_type        = "RabbitMQ"
  engine_version     = "3.13"
  host_instance_type = var.mq_instance_type
  deployment_mode    = "SINGLE_INSTANCE"

  publicly_accessible = false
  subnet_ids          = [aws_subnet.private[0].id]
  security_groups     = [aws_security_group.mq.id]

  user {
    username = var.mq_username
    password = var.mq_password
  }

  tags = { Name = "${var.project_name}-rabbitmq" }
}

# Compose the RABBITMQ_URL from the broker endpoint
# Amazon MQ RabbitMQ uses AMQPS (port 5671)
locals {
  # instances[0].endpoints[0] returns "amqps://<broker-id>.mq.<region>.amazonaws.com:5671"
  mq_endpoint  = replace(aws_mq_broker.rabbitmq.instances[0].endpoints[0], "amqps://", "")
  rabbitmq_url = "amqps://${var.mq_username}:${var.mq_password}@${local.mq_endpoint}"
}
