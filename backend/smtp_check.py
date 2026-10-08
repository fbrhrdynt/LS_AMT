#!/usr/bin/env python3
from email_service import check_smtp_connection_sync

if __name__ == "__main__":
    check_smtp_connection_sync()
    print("SMTP AUTH OK")
