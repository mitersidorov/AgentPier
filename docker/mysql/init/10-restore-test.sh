#!/bin/sh
set -eu

restore_db="${RESTORE_TEST_DB:-agentpier_restore_test}"
case "$restore_db" in
  agentpier_restore_test|agentpier_restore_test_*) ;;
  *) echo "RESTORE_TEST_DB must start with agentpier_restore_test" >&2; exit 1 ;;
esac

mysql --protocol=socket -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
CREATE DATABASE IF NOT EXISTS \`$restore_db\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON \`$restore_db\`.* TO '$MYSQL_USER'@'%';
FLUSH PRIVILEGES;
SQL
