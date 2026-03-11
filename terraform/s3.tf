# ──────────────────────────────────────────
# S3 Bucket for Audio Uploads
# ──────────────────────────────────────────

resource "aws_s3_bucket" "uploads" {
  bucket = "${var.project_name}-uploads-${data.aws_caller_identity.current.account_id}"

  tags = { Name = "${var.project_name}-uploads" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    id     = "expire-old-uploads"
    status = "Enabled"

    filter {
      prefix = "uploads/"
    }

    expiration {
      days = 30
    }
  }
}

# IAM user for S3 access (used by ECS tasks via env vars)
resource "aws_iam_user" "s3_user" {
  name = "${var.project_name}-s3-user"

  tags = { Name = "${var.project_name}-s3-user" }
}

resource "aws_iam_user_policy" "s3_user" {
  name = "s3-upload-access"
  user = aws_iam_user.s3_user.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:PutObject",
        "s3:GetObject",
      ]
      Resource = "${aws_s3_bucket.uploads.arn}/*"
    }]
  })
}

resource "aws_iam_access_key" "s3_user" {
  user = aws_iam_user.s3_user.name
}
