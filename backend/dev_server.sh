#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_PYTHON="$ROOT_DIR/backend/.venv/bin/python"
PID_FILE="$ROOT_DIR/backend/.uvicorn.pid"
LOG_FILE="$ROOT_DIR/backend/.uvicorn.log"

command_name="${1:-start}"

is_running() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 1
  fi
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null
}

start_server() {
  if [[ ! -x "$VENV_PYTHON" ]]; then
    echo "Missing venv python at $VENV_PYTHON"
    echo "Run: python3 -m venv backend/.venv && source backend/.venv/bin/activate && pip install -r backend/requirements.txt"
    exit 1
  fi

  if is_running; then
    echo "Backend already running (PID $(cat "$PID_FILE"))."
    echo "Health: http://127.0.0.1:8000/api/health"
    exit 0
  fi

  cd "$ROOT_DIR"
  nohup "$VENV_PYTHON" -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000 >"$LOG_FILE" 2>&1 &
  pid=$!
  echo "$pid" >"$PID_FILE"
  sleep 1

  if kill -0 "$pid" 2>/dev/null; then
    echo "Backend started in background (PID $pid)."
    echo "Log: $LOG_FILE"
    echo "Health: http://127.0.0.1:8000/api/health"
  else
    echo "Backend failed to start. See logs:"
    tail -n 40 "$LOG_FILE" || true
    rm -f "$PID_FILE"
    exit 1
  fi
}

stop_server() {
  if ! is_running; then
    rm -f "$PID_FILE"
    echo "Backend is not running."
    exit 0
  fi

  pid="$(cat "$PID_FILE")"
  kill "$pid" 2>/dev/null || true
  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 0.25
  done

  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
  fi

  rm -f "$PID_FILE"
  echo "Backend stopped."
}

status_server() {
  if is_running; then
    echo "Backend is running (PID $(cat "$PID_FILE"))."
  else
    echo "Backend is not running."
  fi
}

show_logs() {
  if [[ -f "$LOG_FILE" ]]; then
    tail -n 80 "$LOG_FILE"
  else
    echo "No log file yet: $LOG_FILE"
  fi
}

case "$command_name" in
  start)
    start_server
    ;;
  stop)
    stop_server
    ;;
  restart)
    stop_server
    start_server
    ;;
  status)
    status_server
    ;;
  logs)
    show_logs
    ;;
  *)
    echo "Usage: bash backend/dev_server.sh {start|stop|restart|status|logs}"
    exit 1
    ;;
esac

