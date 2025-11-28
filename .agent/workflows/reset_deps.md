---
description: Reset node_modules and reinstall all dependencies
---

1. Delete existing node_modules folder.
// turbo
2. Run `cmd /c rmdir /s /q node_modules`

3. Delete package-lock.json to avoid version conflicts.
// turbo
4. Run `cmd /c del package-lock.json`

5. Reinstall all dependencies.
// turbo
6. Run `cmd /c npm install`

7. Verify installation completed successfully.

