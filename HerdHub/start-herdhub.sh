#!/bin/bash

# HerdHub Server Daemon - Linux/Unix
# Starts both backend (Express API) and frontend (Vite dev server) as daemons
# Kills existing processes on ports 5175 and 5176 first
# Runs servers in background with proper logging and PID management

set -e

# Configuration
BACKEND_PORT=5176
FRONTEND_PORT=5175
BACKEND_CMD="node server.js"
FRONTEND_CMD="npm run dev"
LOG_DIR="logs"
PID_DIR=".pids"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
BACKEND_PID="$PID_DIR/backend.pid"
FRONTEND_PID="$PID_DIR/frontend.pid"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Print colored message
print_color() {
    echo -e "${2}${1}${NC}"
}

# Print section header
print_header() {
    echo
    print_color "════════════════════════════════════════" "$CYAN"
    print_color "    $1" "$CYAN"
    print_color "════════════════════════════════════════" "$CYAN"
    echo
}

# Check if we're in the right directory
check_directory() {
    if [ ! -f "package.json" ]; then
        print_color "❌ Error: Not in HerdHub directory" "$RED"
        echo "Please run this script from the HerdHub folder"
        exit 1
    fi
}

# Check for required commands
check_requirements() {
    local missing=0

    if ! command -v node &> /dev/null; then
        print_color "❌ Error: Node.js not found" "$RED"
        echo "Please install Node.js from https://nodejs.org/"
        missing=1
    fi

    if ! command -v npm &> /dev/null; then
        print_color "❌ Error: npm not found" "$RED"
        echo "Please install Node.js (includes npm)"
        missing=1
    fi

    if ! command -v lsof &> /dev/null && ! command -v fuser &> /dev/null; then
        print_color "⚠ Warning: lsof or fuser not available" "$YELLOW"
        echo "Port checking may not work properly"
    fi

    if [ $missing -eq 1 ]; then
        exit 1
    fi

    print_color "✅ Requirements satisfied" "$GREEN"
}

# Create necessary directories
create_directories() {
    mkdir -p "$LOG_DIR"
    mkdir -p "$PID_DIR"
    print_color "📁 Created directories: $LOG_DIR, $PID_DIR" "$GREEN"
}

# Kill process by PID file
kill_by_pid_file() {
    local pid_file=$1
    local service=$2

    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            print_color "   Killing $service (PID: $pid)..." "$YELLOW"
            kill -TERM "$pid" 2>/dev/null
            sleep 1
            if kill -0 "$pid" 2>/dev/null; then
                print_color "   Force killing $service (PID: $pid)..." "$YELLOW"
                kill -KILL "$pid" 2>/dev/null
            fi
            rm -f "$pid_file"
            print_color "   ✓ Stopped $service" "$GREEN"
        else
            rm -f "$pid_file"
        fi
    fi
}

# Kill processes on port
kill_port() {
    local port=$1
    local service=$2

    print_color "🔍 Checking port $port ($service)..." "$CYAN"

    # Try lsof first
    if command -v lsof &> /dev/null; then
        local pids=$(lsof -ti:$port 2>/dev/null || echo "")
        if [ -n "$pids" ]; then
            for pid in $pids; do
                print_color "   Killing PID $pid..." "$YELLOW"
                kill -TERM "$pid" 2>/dev/null
                sleep 0.5
                if kill -0 "$pid" 2>/dev/null; then
                    kill -KILL "$pid" 2>/dev/null
                fi
                print_color "   ✓ Killed PID $pid" "$GREEN"
            done
        else
            print_color "   ✓ No processes on port $port" "$GREEN"
        fi
    # Try fuser if lsof not available
    elif command -v fuser &> /dev/null; then
        local pids=$(fuser $port/tcp 2>/dev/null || echo "")
        if [ -n "$pids" ]; then
            for pid in $pids; do
                print_color "   Killing PID $pid..." "$YELLOW"
                kill -TERM "$pid" 2>/dev/null
                sleep 0.5
                if kill -0 "$pid" 2>/dev/null; then
                    kill -KILL "$pid" 2>/dev/null
                fi
                print_color "   ✓ Killed PID $pid" "$GREEN"
            done
        else
            print_color "   ✓ No processes on port $port" "$GREEN"
        fi
    else
        print_color "   ⚠ Could not check port (lsof/fuser not available)" "$YELLOW"
    fi
}

# Kill HerdHub node processes
kill_herdhub_processes() {
    print_color "🔍 Checking for HerdHub processes..." "$CYAN"

    # Find processes by command line
    local pids=$(ps aux | grep -E "(node|npm)" | grep -v grep | grep -E "(server\.js|vite|herdhub)" | awk '{print $2}' || echo "")

    if [ -n "$pids" ]; then
        for pid in $pids; do
            print_color "   Killing HerdHub process PID $pid..." "$YELLOW"
            kill -TERM "$pid" 2>/dev/null
            sleep 0.5
            if kill -0 "$pid" 2>/dev/null; then
                kill -KILL "$pid" 2>/dev/null
            fi
            print_color "   ✓ Killed PID $pid" "$GREEN"
        done
    else
        print_color "   ✓ No HerdHub processes found" "$GREEN"
    fi
}

# Check if port is listening
check_port_listening() {
    local port=$1
    local timeout=${2:-10}
    local start_time=$(date +%s)

    while true; do
        if command -v nc &> /dev/null; then
            if nc -z localhost $port 2>/dev/null; then
                return 0
            fi
        elif command -v ss &> /dev/null; then
            if ss -ltn | grep -q ":$port "; then
                return 0
            fi
        elif command -v netstat &> /dev/null; then
            if netstat -ltn 2>/dev/null | grep -q ":$port "; then
                return 0
            fi
        fi

        local current_time=$(date +%s)
        if [ $((current_time - start_time)) -ge $timeout ]; then
            return 1
        fi

        sleep 1
    done
}

# Start backend server as daemon
start_backend() {
    print_color "🚀 Starting backend server (port $BACKEND_PORT)..." "$BLUE"

    # Kill existing backend
    kill_by_pid_file "$BACKEND_PID" "backend"
    kill_port $BACKEND_PORT "backend"

    # Start backend as daemon
    nohup $BACKEND_CMD >> "$BACKEND_LOG" 2>&1 &
    local pid=$!
    echo $pid > "$BACKEND_PID"

    print_color "   Backend started with PID: $pid" "$GREEN"
    print_color "   Logs: $BACKEND_LOG" "$CYAN"

    # Wait for backend to start
    print_color "   Waiting for backend to start..." "$CYAN"
    if check_port_listening $BACKEND_PORT 15; then
        print_color "   ✓ Backend is listening on port $BACKEND_PORT" "$GREEN"
        return 0
    else
        print_color "   ❌ Backend failed to start" "$RED"
        return 1
    fi
}

# Start frontend server as daemon
start_frontend() {
    print_color "🚀 Starting frontend server (port $FRONTEND_PORT)..." "$BLUE"

    # Kill existing frontend
    kill_by_pid_file "$FRONTEND_PID" "frontend"
    kill_port $FRONTEND_PORT "frontend"

    # Start frontend as daemon
    cd "$(dirname "$0")"  # Ensure we're in the right directory
    nohup $FRONTEND_CMD >> "$FRONTEND_LOG" 2>&1 &
    local pid=$!
    echo $pid > "$FRONTEND_PID"

    print_color "   Frontend started with PID: $pid" "$GREEN"
    print_color "   Logs: $FRONTEND_LOG" "$CYAN"

    # Wait for frontend to start
    print_color "   Waiting for frontend to start..." "$CYAN"
    if check_port_listening $FRONTEND_PORT 15; then
        print_color "   ✓ Frontend is listening on port $FRONTEND_PORT" "$GREEN"
        return 0
    else
        print_color "   ❌ Frontend failed to start" "$RED"
        return 1
    fi
}

# Install dependencies if needed
install_dependencies() {
    print_color "📦 Checking dependencies..." "$BLUE"

    if [ ! -d "node_modules" ] || [ ! -f "node_modules/.bin/vite" ]; then
        print_color "   Installing dependencies..." "$CYAN"
        if npm ci --silent; then
            print_color "   ✓ Dependencies installed" "$GREEN"
        else
            print_color "   ⚠ Dependency installation had issues" "$YELLOW"
        fi
    else
        print_color "   ✓ Dependencies already installed" "$GREEN"
    fi
}

# Verify servers are running
verify_servers() {
    print_color "🔍 Verifying servers..." "$BLUE"
    local all_ok=true

    # Check backend
    if check_port_listening $BACKEND_PORT 5; then
        print_color "   ✓ Backend is running on port $BACKEND_PORT" "$GREEN"
    else
        print_color "   ❌ Backend is not responding" "$RED"
        all_ok=false
    fi

    # Check frontend
    if check_port_listening $FRONTEND_PORT 5; then
        print_color "   ✓ Frontend is running on port $FRONTEND_PORT" "$GREEN"
    else
        print_color "   ❌ Frontend is not responding" "$RED"
        all_ok=false
    fi

    echo
    if $all_ok; then
        print_color "✅ ALL SERVERS ARE RUNNING!" "$GREEN"
    else
        print_color "⚠ SOME SERVERS MAY NOT BE RUNNING PROPERLY" "$YELLOW"
    fi
}

# Show status
show_status() {
    print_header "HERDHUB STATUS"

    print_color "📊 Server Status:" "$CYAN"

    # Backend status
    if [ -f "$BACKEND_PID" ]; then
        local pid=$(cat "$BACKEND_PID")
        if kill -0 "$pid" 2>/dev/null; then
            print_color "   Backend:  ✅ RUNNING (PID: $pid)" "$GREEN"
        else
            print_color "   Backend:  ❌ STOPPED (stale PID file)" "$RED"
        fi
    else
        print_color "   Backend:  ❌ STOPPED" "$RED"
    fi

    # Frontend status
    if [ -f "$FRONTEND_PID" ]; then
        local pid=$(cat "$FRONTEND_PID")
        if kill -0 "$pid" 2>/dev/null; then
            print_color "   Frontend: ✅ RUNNING (PID: $pid)" "$GREEN"
        else
            print_color "   Frontend: ❌ STOPPED (stale PID file)" "$RED"
        fi
    else
        print_color "   Frontend: ❌ STOPPED" "$RED"
    fi

    echo
    print_color "🌐 Access URLs:" "$CYAN"
    print_color "   Frontend: http://localhost:$FRONTEND_PORT" "$MAGENTA"
    print_color "   Backend:  http://localhost:$BACKEND_PORT" "$CYAN"

    echo
    print_color "📁 Log files:" "$CYAN"
    print_color "   Backend:  $BACKEND_LOG" "$MAGENTA"
    print_color "   Frontend: $FRONTEND_LOG" "$CYAN"

    echo
    print_color "🛑 To stop servers: ./stop-herdhub.sh" "$YELLOW"
}

# Main start function
main_start() {
    print_header "STARTING HERDHUB SERVERS"

    check_directory
    check_requirements
    create_directories

    print_color "Step 1: Stopping existing servers..." "$BLUE"
    kill_herdhub_processes
    kill_port $BACKEND_PORT "backend"
    kill_port $FRONTEND_PORT "frontend"
    echo

    print_color "Step 2: Installing dependencies..." "$BLUE"
    install_dependencies
    echo

    print_color "Step 3: Starting servers..." "$BLUE"
    local backend_ok=true
    local frontend_ok=true

    if ! start_backend; then
        backend_ok=false
    fi
    echo

    if ! start_frontend; then
        frontend_ok=false
    fi
    echo

    if $backend_ok && $frontend_ok; then
        verify_servers
        echo

        print_header "HERDHUB SERVERS STARTED SUCCESSFULLY"
        print_color "🌐 Access URLs:" "$CYAN"
        print_color "   Frontend: http://localhost:$FRONTEND_PORT" "$MAGENTA"
        print_color "   Backend API: http://localhost:$BACKEND_PORT" "$CYAN"
        echo
        print_color "📁 Log files:" "$CYAN"
        print_color "   Backend:  $BACKEND_LOG" "$MAGENTA"
        print_color "   Frontend: $FRONTEND_LOG" "$CYAN"
        echo
        print_color "📋 Check status: ./start-herdhub.sh status" "$YELLOW"
        print_color "🛑 Stop servers: ./stop-herdhub.sh" "$YELLOW"
        print_color "📺 View logs: tail -f $BACKEND_LOG $FRONTEND_LOG" "$YELLOW"
    else
        print_color "❌ FAILED TO START ALL SERVERS" "$RED"
        print_color "Check log files for errors:" "$YELLOW"
        print_color "   tail -n 50 $BACKEND_LOG $FRONTEND_LOG" "$YELLOW"
        exit 1
    fi
}

# Handle different commands
case "${1:-start}" in
    start)
        main_start
        ;;
    status)
        show_status
        ;;
    restart)
        print_color "Restarting HerdHub servers..." "$CYAN"
        if [ -f "./stop-herdhub.sh" ]; then
            ./stop-herdhub.sh
            sleep 2
        fi
        main_start
        ;;
    help|--help|-h)
        print_header "HERDHUB SERVER MANAGER"
        print_color "Usage: ./start-herdhub.sh [command]" "$CYAN"
        echo
        print_color "Commands:" "$CYAN"
        print_color "  start     Start servers (default)" "$GREEN"
        print_color "  status    Show server status" "$GREEN"
        print_color "  restart   Restart servers" "$GREEN"
        print_color "  help      Show this help" "$GREEN"
        echo
        print_color "Examples:" "$CYAN"
        print_color "  ./start-herdhub.sh           # Start servers" "$YELLOW"
        print_color "  ./start-herdhub.sh status    # Check status" "$YELLOW"
        print_color "  ./start-herdhub.sh restart   # Restart servers" "$YELLOW"
        ;;
    *)
        print_color "Unknown command: $1" "$RED"
        print_color "Use: ./start-herdhub.sh help" "$YELLOW"
        exit 1
        ;;
esac
