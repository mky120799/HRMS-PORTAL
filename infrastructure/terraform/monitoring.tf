resource "aws_sns_topic" "alarms" {
  name = "${local.name}-alarms"
}

resource "aws_sns_topic_subscription" "alarm_email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals {
  alarms = {
    api-5xx = {
      namespace = "AWS/ApplicationELB", metric = "HTTPCode_Target_5XX_Count", stat = "Sum", threshold = 10, op = "GreaterThanThreshold"
      dims      = { LoadBalancer = aws_lb.main.arn_suffix, TargetGroup = aws_lb_target_group.server.arn_suffix }
      desc      = "API returned more than 10 server errors in 5 minutes"
    }
    api-latency = {
      namespace = "AWS/ApplicationELB", metric = "TargetResponseTime", stat = "Average", threshold = 1.5, op = "GreaterThanThreshold"
      dims      = { LoadBalancer = aws_lb.main.arn_suffix, TargetGroup = aws_lb_target_group.server.arn_suffix }
      desc      = "Average API latency above 1.5 s"
    }
    api-no-healthy-hosts = {
      namespace = "AWS/ApplicationELB", metric = "HealthyHostCount", stat = "Minimum", threshold = 1, op = "LessThanThreshold"
      dims      = { LoadBalancer = aws_lb.main.arn_suffix, TargetGroup = aws_lb_target_group.server.arn_suffix }
      desc      = "No healthy API tasks"
    }
    db-cpu = {
      namespace = "AWS/RDS", metric = "CPUUtilization", stat = "Average", threshold = 80, op = "GreaterThanThreshold"
      dims      = { DBInstanceIdentifier = aws_db_instance.main.identifier }
      desc      = "Database CPU above 80%"
    }
    db-storage = {
      namespace = "AWS/RDS", metric = "FreeStorageSpace", stat = "Minimum", threshold = 2147483648, op = "LessThanThreshold"
      dims      = { DBInstanceIdentifier = aws_db_instance.main.identifier }
      desc      = "Database free storage below 2 GB"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "this" {
  for_each            = local.alarms
  alarm_name          = "${local.name}-${each.key}"
  alarm_description   = each.value.desc
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  statistic           = each.value.stat
  dimensions          = each.value.dims
  period              = 300
  evaluation_periods  = 1
  threshold           = each.value.threshold
  comparison_operator = each.value.op
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}
