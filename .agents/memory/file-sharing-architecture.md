---
name: File sharing architecture
description: Durable design rule for uploaded files and QR codes in this project.
---

The QR code should contain the application's served object URL, not the file bytes or a short-lived upload URL. File bytes go directly to App Storage through a signed PUT URL; the API only mints the URL and serves the stored object.

**Why:** QR payloads must remain scannable after the upload URL expires, and proxying large files through the API adds unnecessary load.

**How to apply:** Keep the upload request and object-serving endpoints separate. Use the returned object path to construct a stable `/api/storage/objects/...` link for QR generation and sharing.