# Gunicorn configuration for Backend FastAPI
# VPS Deployment

import multiprocessing

# Server socket
bind = "127.0.0.1:8000"
backlog = 2048

# Worker processes
workers = 4  # 1 per vCPU
worker_class = "uvicorn.workers.UvicornWorker"
worker_connections = 1000
max_requests = 1000
max_requests_jitter = 50
timeout = 30
keepalive = 2

accesslog = "/var/log/cxgame/backend-access.log"
errorlog = "/var/log/cxgame/backend-error.log"
loglevel = "info"
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)s'

# Process naming
proc_name = "cxgame-backend"

# Server mechanics
daemon = False
pidfile = None  # Let systemd handle PID
umask = 0o007

# SSL (handled by Nginx)
# No SSL configuration needed here

def on_starting(server):
    """Called just before the master process is initialized."""
    print("Starting CX Game Backend...")

def on_reload(server):
    """Called to recycle workers during a reload via SIGHUP."""
    print("Reloading CX Game Backend...")

def when_ready(server):
    """Called just after the server is started."""
    print("CX Game Backend is ready. Listening on: %s" % bind)

def on_exit(server):
    """Called just before exiting."""
    print("Shutting down CX Game Backend...")
