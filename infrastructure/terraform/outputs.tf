output "alb_dns_name" {
  description = "Point your domain (CNAME/alias) at this"
  value       = aws_lb.main.dns_name
}

output "ecr_server_url" {
  value = aws_ecr_repository.server.repository_url
}

output "ecr_web_url" {
  value = aws_ecr_repository.web.repository_url
}

output "ecs_cluster" {
  value = aws_ecs_cluster.main.name
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "app_security_group_id" {
  value = aws_security_group.app.id
}

output "integrations_secret_arn" {
  description = "Fill in Stripe / Gemini / Google / Sentry values here"
  value       = aws_secretsmanager_secret.integrations.arn
}

output "ses_dkim_tokens" {
  description = "Create CNAME records <token>._domainkey.<email_domain> → <token>.dkim.amazonses.com"
  value       = aws_ses_domain_dkim.main.dkim_tokens
}
