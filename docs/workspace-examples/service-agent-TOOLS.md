# Service Agent TOOLS.md

Service agent tools define the **security configuration** and external dependencies. Focus on:

- **Whitelists** (commands, URLs, operations)
- External service endpoints and API details
- Resource constraints (timeouts, rate limits)
- Error handling patterns
- Audit logging configuration

## Example: Whitelisted Command Execution Service

```
### Security Whitelist
ALLOWED_COMMANDS:
  - "weather": runs `curl https://weather-api.example.com`
  - "date": runs `date`
  - "hostname": runs `hostname`
  - "disk_usage": runs `df -h` (filtered output only)

REJECTED_PATTERNS:
  - Any command containing: $(, ``, |, ;, &, >, <, etc.
  - Any path traversal: ../, ..\\
  - Any attempt to access: /etc/, /root/, /home/, ~/.ssh/, etc.

### Endpoint
Service: Local command execution with whitelist validation
Timeout: 10 seconds per command
Max concurrent: 1 per user (prevent DOS)
Rate limit: 5 requests/minute per user

### Response
{
  "success": true,
  "data": "[command output, filtered]",
  "metadata": {
    "command": "weather",
    "user_id": "child-01",
    "elapsed_ms": 523
  }
}
```

## Example: Whitelisted Website Lookup Service

```
### Security Whitelist
ALLOWED_URLS:
  - https://en.wikipedia.org/*
  - https://www.weather.gov/*
  - https://www.nasa.gov/*

DENIED_PATTERNS:
  - Any URL not matching whitelist
  - Any URL containing credentials (user:pass@)
  - Any URL with port != 80, 443
  - Any URL with fragments that look like scripts

### Endpoint
Service: HTTP GET fetch with whitelist + content filtering
Timeout: 15 seconds
Max page size: 2 MB
Rate limit: 10 requests/minute per user

### Response
{
  "success": true,
  "data": "[HTML content, stripped of scripts/dangerous tags]",
  "metadata": {
    "url": "https://en.wikipedia.org/wiki/France",
    "bytes_fetched": 45230,
    "user_id": "child-01",
    "elapsed_ms": 1250
  }
}
```

## Example: System Query Service (Filtered)

```
### Security Whitelist
ALLOWED_QUERIES:
  - "disk_usage": returns { total, used, available, percent }
  - "memory_usage": returns { total, used, available, percent }
  - "uptime": returns { days, hours, minutes }
  - "date": returns { timestamp, human_readable }

DENIED_QUERIES:
  - Anything requiring root
  - Anything accessing /proc/cmdline (kernel args)
  - Anything accessing /etc/passwd (user list)
  - Anything accessing ~/.ssh (keys)
  - Anything accessing environment variables

### Output Filtering
All responses are filtered to show only safe, non-sensitive data:
- Never include full paths
- Never include usernames or UIDs
- Never include process command lines
- Never include network socket details
- Never include loaded module names

### Response
{
  "success": true,
  "data": {
    "disk_usage_percent": 42,
    "disk_warning": false,
    "memory_usage_percent": 55,
    "memory_warning": false
  },
  "metadata": {
    "query": "system_status",
    "user_id": "child-01",
    "elapsed_ms": 50
  }
}
```


## Configuration

Service-specific security and operational config:

```
### Environment Variables (Security Critical)
SERVICE_PORT=19001
SERVICE_LOG_LEVEL=info
TIMEOUT_DEFAULT=15          # Max seconds per request
MAX_RETRIES=2               # Limit retries on failure
RATE_LIMIT_PER_USER=10      # Max requests/minute per user
RATE_LIMIT_GLOBAL=100       # Max requests/minute total
AUDIT_LOG_FILE=/var/log/service_audit.log
ERROR_LOG_FILE=/var/log/service_error.log
```

### Whitelist Configuration File
Store whitelists in a separate config file (never inline in code):

```ini
[allowed_commands]
weather=curl https://weather-api.example.com
date=date
hostname=hostname

[allowed_urls]
wikipedia=https://en.wikipedia.org/*
weather=https://www.weather.gov/*
nasa=https://www.nasa.gov/*

[forbidden_patterns]
shell_metacharacters=$,`,|,;,&,>,<
path_traversal=../,..\\
```

## Secrets (DO NOT STORE ACTUAL VALUES)

Sensitive credentials are **never** stored in config files or code. Use environment variables only:

```
### API Keys & Tokens (Environment Variables Only)
API_TOKEN=[stored in environment, never logged or exposed]
DATABASE_PASSWORD=[stored in environment, never logged or exposed]
SSH_KEY=[stored in environment, never logged or exposed]

### Audit Logging
All requests logged to: /var/log/service_audit.log
Never log: passwords, tokens, keys, PII
Always log: user_id, operation, timestamp, success/failure, IP address
```

## Monitoring & Audit

### Health Check
```
GET /health → {"status": "healthy", "uptime": "2.5h", "requests": 450}
```

### Audit Log Monitoring
```
Audit log: tail -f /var/log/service_audit.log
Error log: tail -f /var/log/service_error.log
Suspicious activity: grep "REJECTED\|DENIED\|FAILED" /var/log/service_audit.log

Example queries:
- All requests from child-01: grep "user_id=child-01" /var/log/service_audit.log
- All rejected requests: grep "REJECTED" /var/log/service_audit.log
- Failed executions: grep "success=false" /var/log/service_audit.log
```

## Dependencies

```
External:
- [Service/API Name]: [URL or location, if accessible]
- APIs: [Documented whitelisted endpoints only]

Local:
- Port [number]: [What's listening, if exposed to child agents]
- Log directory: /var/log/service_audit.log [audit trail]
- Whitelist file: [location of allowed operations]
```
