PID=$(pidof com.sigmark.app)
echo "app pid=$PID"
echo "=== mapped files NOT under system/apex/vendor/product/odm/data-app ==="
run-as com.sigmark.app cat /proc/$PID/maps 2>&1 | awk '{print $6}' | grep -v '^$' | sed 's/ (deleted)$//' | sort -u | grep -vE '^/(system|apex|vendor|product|odm|system_ext|dev)' | head -40
echo "=== unique mapped files ==="
run-as com.sigmark.app cat /proc/$PID/maps 2>&1 | awk '{print $6}' | grep -v '^$' | sort -u | wc -l
echo "=== /data paths ==="
run-as com.sigmark.app cat /proc/$PID/maps 2>&1 | awk '{print $6}' | grep -E '^/data' | sort -u | head -20
echo "=== deleted ==="
run-as com.sigmark.app cat /proc/$PID/maps 2>&1 | grep -c deleted