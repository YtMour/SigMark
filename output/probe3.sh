PID=$(pidof com.sigmark.app)
echo "app pid=$PID"
echo "=== non-standard mappings in the app process ==="
run-as com.sigmark.app cat /proc/$PID/maps 2>&1 | awk '{print $6}' | grep -v '^$' | sed 's/ (deleted)$//' | sort -u | grep -vE '^/(system|apex|vendor|product|odm|system_ext|data/app|dev|memfd)' | head -40
echo "=== all mapped files count ==="
run-as com.sigmark.app cat /proc/$PID/maps 2>&1 | awk '{print $6}' | grep -v '^$' | sort -u | wc -l
echo "=== data/ mappings ==="
run-as com.sigmark.app cat /proc/$PID/maps 2>&1 | awk '{print $6}' | grep -E '^/data' | sort -u | head -20
echo "=== deleted mappings ==="
run-as com.sigmark.app cat /proc/$PID/maps 2>&1 | grep deleted | head -10