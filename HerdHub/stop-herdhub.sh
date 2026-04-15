#!/bin/bash

# HerdHub Server Stopper - Linux/Unix
# Stops both backend (Express API) and frontend (Vite dev server) daemons
# Uses PID files and port checking to ensure clean shutdown

set -e

# Configuration
BACKEND_PORT=5176
FRONTEND_PORT=5175
LOG_DIR="logs"
PID_DIR=".pids"
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

# Kill process by PID file
kill_by_pid_file() {
    local pid_file=$1
    local service=$2

    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if [ -n "$pid" ]; then
            print_color "   Stopping $service (PID: $pid)..." "$YELLOW"

            # Try graceful shutdown first
            if kill -0 "$pid" 2>/dev/null; then
                kill -TERM "$pid" 2>/dev/null

                # Wait for graceful shutdown (5 seconds)
                local timeout=5
                while kill -0 "$pid" 2>/dev/null && [ $timeout -gt 0 ]; do
                    sleep 1
                    timeout=$((timeout - 1))
                done

                # Force kill if still running
                if kill -0 "$pid" 2>/dev/null; then
                    print_color "   Force killing $service..." "$YELLOW"
                    kill -KILL "$pid" 2>/dev/null
                    sleep 1
                fi

                print_color "   ✓ Stopped $service" "$GREEN"
            else
                print_color "   ⚠ Process $pid not running (stale PID file)" "$YELLOW"
            fi

            # Remove PID file
            rm -f "$pid_file"
        else
            print_color "   ⚠ Empty PID file: $pid_file" "$YELLOW"
            rm -f "$pid_file"
        fi
    else
        print_color "   ✓ No PID file for $service" "$GREEN"
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
                print_color "   Killing process on port $port (PID: $pid)..." "$YELLOW"

                # Try graceful shutdown
                kill -TERM "$pid" 2>/dev/null
                sleep 0.5

                # Force kill if still running
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
                print_color "   Killing process on port $port (PID: $pid)..." "$YELLOW"

                # Try graceful shutdown
                kill -TERM "$pid" 2>/dev/null
                sleep 0.5

                # Force kill if still running
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
            print_color "   Killing HerdHub process (PID: $pid)..." "$YELLOW"

            # Try graceful shutdown
            kill -TERM "$pid" 2>/dev/null
            sleep 0.5

            # Force kill if still running
            if kill -0 "$pid" 2>/dev/null; then
                kill -KILL "$pid" 2>/dev/null
            fi

            print_color "   ✓ Killed PID $pid" "$GREEN"
        done
    else
        print_color "   ✓ No HerdHub processes found" "$GREEN"
    fi
}

# Check if port is free
check_port_free() {
    local port=$1

    if command -v lsof &> /dev/null; then
        if lsof -ti:$port >/dev/null 2>&1; then
            return 1  # Port is in use
        else
            return 0  # Port is free
        fi
    elif command -v fuser &> /dev/null; then
        if fuser $port/tcp >/dev/null 2>&1; then
            return 1  # Port is in use
        else
            return 0  # Port is free
        fi
    elif command -v ss &> /dev/null; then
        if ss -ltn | grep -q ":$port "; then
            return 1  # Port is in use
        else
            return 0  # Port is free
        fi
    elif command -v netstat &> /dev/null; then
        if netstat -ltn 2>/dev/null | grep -q ":$port "; then
            return 1  # Port is in use
        else
            return 0  # Port is free
        fi
    else
        # Can't check, assume it's free
        return 0
    fi
}

# Clean up old log files
cleanup_logs() {
    print_color "🧹 Cleaning up..." "$CYAN"

    # Remove empty log files
    find "$LOG_DIR" -name "*.log" -type f -size 0 -delete 2>/dev/null || true

    # Remove PID directory if empty
    if [ -d "$PID_DIR" ] && [ -z "$(ls -A "$PID_DIR" 2>/dev/null)" ]; then
        rmdir "$PID_DIR" 2>/dev/null || true
    fi

    print_color "   ✓ Cleanup complete" "$GREEN"
}

# Show what was stopped
show_stopped_summary() {
    local total_killed=$1
    local all_clear=$2

    print_header "SHUTDOWN COMPLETE"

    if [ $all_clear -eq 1 ]; then
        print_color "✅ ALL HERDHUB SERVERS STOPPED!" "$GREEN"
        echo
        print_color "   Stopped $total_killed processes" "$GREEN"
        print_color "   Ports $BACKEND_PORT and $FRONTEND_PORT are free" "$GREEN"
    else
        print_color "⚠ SOME PROCESSES MAY STILL BE RUNNING" "$YELLOW"
        echo
        print_color "   Stopped $total_killed processes" "$YELLOW"
        print_color "   Some ports may still be in use" "$YELLOW"
        echo
        print_color "If issues persist:" "$YELLOW"
        print_color "   1. Run with sudo: sudo ./stop-herdhub.sh" "$YELLOW"
        print_color "   2. Check manually:" "$YELLOW"
        print_color "      lsof -i :$BACKEND_PORT -i :$FRONTEND_PORT" "$YELLOW"
        print_color "   3. Use system monitor to kill remaining processes" "$YELLOW"
        print_color "   4. Manual cleanup:" "$YELLOW"
        print_color "      pkill -f \"node server.js\|npm run dev\"" "$YELLOW"
    fi

    echo
    print_color "📁 Log files preserved in: $LOG_DIR/" "$CYAN"
    print_color "🚀 To restart: ./start-herdhub.sh" "$YELLOW"
}

# Main stop function
main_stop() {
    print_header "STOPPING HERDHUB SERVERS"

    check_directory

    local total_killed=0
    local all_clear=1

    print_color "Step 1: Stopping by PID files..." "$BLUE"
    echo

    # Stop backend by PID file
    print_color "Backend server:" "$CYAN"
    kill_by_pid_file "$BACKEND_PID" "backend"
    echo

    # Stop frontend by PID file
    print_color "Frontend server:" "$CYAN"
    kill_by_pid_file "$FRONTEND_PID" "frontend"
    echo

    print_color "Step 2: Stopping processes on ports..." "$BLUE"
    echo

    # Kill processes on backend port
    kill_port $BACKEND_PORT "backend"
    echo

    # Kill processes on frontend port
    kill_port $FRONTEND_PORT "frontend"
    echo

    print_color "Step 3: Stopping any remaining HerdHub processes..." "$BLUE"
    echo
    kill_herdhub_processes
    echo

    # Wait a moment for processes to fully terminate
    print_color "Step 4: Verifying ports are free..." "$BLUE"
    echo
    sleep 2

    # Check backend port
    if check_port_free $BACKEND_PORT; then
        print_color "   ✓ Port $BACKEND_PORT is free" "$GREEN"
    else
        print_color "   ❌ Port $BACKEND_PORT is still in use!" "$RED"
        all_clear=0
    fi

    # Check frontend port
    if check_port_free $FRONTEND_PORT; then
        print_color "   ✓ Port $FRONTEND_PORT is free" "$GREEN"
    else
        print_color "   ❌ Port $FRONTEND_PORT is still in use!" "$RED"
        all_clear=0
    fi
    echo

    # Cleanup
    cleanup_logs
    echo

    # Show summary
    show_stopped_summary $total_killed $all_clear
}

# Handle different commands
case "${1:-stop}" in
    stop)
        main_stop
        ;;
    help|--help|-h)
        print_header "HERDHUB SERVER STOPPER"
        print_color "Usage: ./stop-herdhub.sh [command]" "$CYAN"
        echo
        print_color "Commands:" "$CYAN"
        print_color "  stop      Stop servers (default)" "$GREEN"
        print_color "  help      Show this help" "$GREEN"
        echo
        print_color "Examples:" "$CYAN"
        print_color "  ./stop-herdhub.sh        # Stop servers" "$YELLOW"
        print_color "  ./stop-herdhub.sh help   # Show help" "$YELLOW"
        ;;
    *)
        print_color "Unknown command: $1" "$RED"
        print_color "Use: ./stop-herdhub.sh help" "$YELLOW"
        exit 1
        ;;
esac
