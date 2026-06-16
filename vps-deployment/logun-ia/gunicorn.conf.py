# Gunicorn configuration for Logun-IA

import multiprocessing

# Server socket
bind = "127.0.0.1:8001"
backlog = 2048

# Worker processes
workers = 2  # 2 workers para Logun-IA (menos carga que backend)
worker_class = "uvicorn.workers.UvicornWorker"
worker_connections = 1000
timeout = 60  # 60s timeout (Logun pode demorar até 8s + overhead)
keepalive = 5

# Logging
accesslog = "/var/log/cxgame/logun-access.log"
errorlog = "/var/log/cxgame/logun-error.log"
loglevel = "info"
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)s'

# Process naming
proc_name = "logun-ia"

# Server mechanics
daemon = False
pidfile = None
umask = 0
user = None
group = None
tmp_upload_dir = None

# SSL (handled by Nginx)
keyfile = None
certfile = None
