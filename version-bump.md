# Version bump script for v7.0.48

## Purpose
This script will:
1. Bump version from v7.0.47 to v7.0.48
2. Build the application (Electron exe and web build)
3. Restart the server with the new version

## Steps
1. Check current version
2. Update version in package.json files
3. Run build scripts
4. Restart services
5. Verify new version is running

## Commands to run
```bash
# Bump version to v7.0.48
npm version --no-git-tag-version 7.0.48

# Build the application
npm run build

# Restart the server
npm run restart

# Verify version
./release/agentforge-web-v7.0.48.exe --version
```

## Expected results
- Version bumped to 7.0.48
- Build passes without errors
- Server restarts with new version
- Version verification returns 7.0.48
