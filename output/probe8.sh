PID=$(pidof com.sigmark.app)
echo "=== all .so under /apex or /vendor in maps (unique, first 15) ==="
run-as com.sigmark.app cat /proc/$PID/maps 2>/dev/null | awk '{print $6}' | grep -E '\.so$' | sort -u | head -15
echo "=== total .so count ==="
run-as com.sigmark.app cat /proc/$PID/maps 2>/dev/null | awk '{print $6}' | grep -cE '\.so$'