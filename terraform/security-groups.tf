# ──────────────────────────────────────────
# ALB Security Group
# ──────────────────────────────────────────

resource "aws_security_group" "alb" {
  name_prefix = "${var.project_name}-alb-"
  description = "ALB - allow HTTP/HTTPS from internet"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.project_name}-alb-sg" }

  lifecycle { create_before_destroy = true }
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP from internet"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from internet"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_vpc" {
  security_group_id = aws_security_group.alb.id
  description       = "All traffic to VPC"
  ip_protocol       = "-1"
  cidr_ipv4         = var.vpc_cidr
}

# ──────────────────────────────────────────
# Server Security Group
# ──────────────────────────────────────────

resource "aws_security_group" "server" {
  name_prefix = "${var.project_name}-server-"
  description = "Server - allow traffic from ALB, access RDS/MQ/S3"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.project_name}-server-sg" }

  lifecycle { create_before_destroy = true }
}

resource "aws_vpc_security_group_ingress_rule" "server_from_alb" {
  security_group_id            = aws_security_group.server.id
  description                  = "HTTP from ALB"
  from_port                    = 3000
  to_port                      = 3000
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_egress_rule" "server_to_rds" {
  security_group_id            = aws_security_group.server.id
  description                  = "PostgreSQL to RDS"
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.rds.id
}

resource "aws_vpc_security_group_egress_rule" "server_to_mq" {
  security_group_id            = aws_security_group.server.id
  description                  = "AMQPS to Amazon MQ"
  from_port                    = 5671
  to_port                      = 5671
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.mq.id
}

resource "aws_vpc_security_group_egress_rule" "server_to_https" {
  security_group_id = aws_security_group.server.id
  description       = "HTTPS outbound (S3 via VPC endpoint, etc.)"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  cidr_ipv4         = "0.0.0.0/0"
}

# ──────────────────────────────────────────
# Worker Security Group
# ──────────────────────────────────────────

resource "aws_security_group" "worker" {
  name_prefix = "${var.project_name}-worker-"
  description = "Worker - no inbound, access RDS/MQ/S3/OpenAI"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.project_name}-worker-sg" }

  lifecycle { create_before_destroy = true }
}

resource "aws_vpc_security_group_egress_rule" "worker_to_rds" {
  security_group_id            = aws_security_group.worker.id
  description                  = "PostgreSQL to RDS"
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.rds.id
}

resource "aws_vpc_security_group_egress_rule" "worker_to_mq" {
  security_group_id            = aws_security_group.worker.id
  description                  = "AMQPS to Amazon MQ"
  from_port                    = 5671
  to_port                      = 5671
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.mq.id
}

resource "aws_vpc_security_group_egress_rule" "worker_to_https" {
  security_group_id = aws_security_group.worker.id
  description       = "HTTPS outbound (S3, OpenAI API)"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  cidr_ipv4         = "0.0.0.0/0"
}

# ──────────────────────────────────────────
# Frontend Security Group
# ──────────────────────────────────────────

resource "aws_security_group" "frontend" {
  name_prefix = "${var.project_name}-frontend-"
  description = "Frontend - allow traffic from ALB only"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.project_name}-frontend-sg" }

  lifecycle { create_before_destroy = true }
}

resource "aws_vpc_security_group_ingress_rule" "frontend_from_alb" {
  security_group_id            = aws_security_group.frontend.id
  description                  = "HTTP from ALB"
  from_port                    = 8080
  to_port                      = 8080
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_egress_rule" "frontend_to_https" {
  security_group_id = aws_security_group.frontend.id
  description       = "HTTPS outbound (Secrets Manager, GHCR, CloudWatch)"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  cidr_ipv4         = "0.0.0.0/0"
}

# ──────────────────────────────────────────
# RDS Security Group
# ──────────────────────────────────────────

resource "aws_security_group" "rds" {
  name_prefix = "${var.project_name}-rds-"
  description = "RDS - allow PostgreSQL from server and worker"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.project_name}-rds-sg" }

  lifecycle { create_before_destroy = true }
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_server" {
  security_group_id            = aws_security_group.rds.id
  description                  = "PostgreSQL from server"
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.server.id
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_worker" {
  security_group_id            = aws_security_group.rds.id
  description                  = "PostgreSQL from worker"
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.worker.id
}

# ──────────────────────────────────────────
# Amazon MQ Security Group
# ──────────────────────────────────────────

resource "aws_security_group" "mq" {
  name_prefix = "${var.project_name}-mq-"
  description = "Amazon MQ - allow AMQPS from server and worker"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.project_name}-mq-sg" }

  lifecycle { create_before_destroy = true }
}

resource "aws_vpc_security_group_ingress_rule" "mq_from_server" {
  security_group_id            = aws_security_group.mq.id
  description                  = "AMQPS from server"
  from_port                    = 5671
  to_port                      = 5671
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.server.id
}

resource "aws_vpc_security_group_ingress_rule" "mq_from_worker" {
  security_group_id            = aws_security_group.mq.id
  description                  = "AMQPS from worker"
  from_port                    = 5671
  to_port                      = 5671
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.worker.id
}
