#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_PYTHON="$ROOT_DIR/backend/.venv/bin/python"
PID_FILE="$ROOT_DIR/backend/.uvicorn.pid"
LOG_FILE="$ROOT_DIR/backend/.uvicorn.log"
BACKEND_PORT="8000"

command_name="${1:-start}"

is_running() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 1
  fi
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null
}

find_listener_pid() {
  if ! command -v lsof >/dev/null 2>&1; then
    return 1
  fi

  listener_pid="$(lsof -tiTCP:${BACKEND_PORT} -sTCP:LISTEN -nP 2>/dev/null | head -n 1 || true)"
  [[ -n "${listener_pid:-}" ]] || return 1

  echo "$listener_pid"
}

start_server() {
  if [[ ! -x "$VENV_PYTHON" ]]; then
    echo "Missing venv python at $VENV_PYTHON"
    echo "Run: python3 -m venv backend/.venv && source backend/.venv/bin/activate && pip install -r backend/requirements.txt"
    exit 1
  fi

  if is_running; then
    echo "Backend already running (PID $(cat "$PID_FILE"))."
    echo "Health: http://127.0.0.1:${BACKEND_PORT}/api/health"
    exit 0
  fi

  if listener_pid="$(find_listener_pid)"; then
    echo "Port ${BACKEND_PORT} is already in use by PID ${listener_pid}."
      echo "Backend may already be running outside dev_server.sh."
      echo "Health: http://127.0.0.1:${BACKEND_PORT}/api/health"
      return 0
  fi

  cd "$ROOT_DIR"
  nohup "$VENV_PYTHON" -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port "${BACKEND_PORT}" >"$LOG_FILE" 2>&1 &
  pid=$!
  echo "$pid" >"$PID_FILE"
  sleep 1

  if kill -0 "$pid" 2>/dev/null; then
    echo "Backend started in background (PID $pid)."
    echo "Log: $LOG_FILE"
    echo "Health: http://127.0.0.1:${BACKEND_PORT}/api/health"
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
    if listener_pid="$(find_listener_pid)"; then
      echo "Backend is listening on port ${BACKEND_PORT} (PID ${listener_pid}),"
      echo "but it is not managed by dev_server.sh."
      echo "Stop it manually with: kill ${listener_pid}"
      exit 0
    fi
    echo "Backend is not running."
    return 0
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
    return 0
  fi

  if listener_pid="$(find_listener_pid)"; then
    echo "Backend appears to be running on port ${BACKEND_PORT} (PID ${listener_pid}),"
    echo "but it is not managed by dev_server.sh (missing or stale PID file)."
    return 0
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
