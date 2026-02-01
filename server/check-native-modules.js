#!/usr/bin/env node
/**
 * Native Module Compatibility Checker
 * 
 * Verifies that native Node.js modules (like better-sqlite3) are compiled
 * for the current Node.js version. Provides helpful error messages and
 * automatic rebuild suggestions when version mismatches are detected.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Native modules that need version compatibility checks
const NATIVE_MODULES = ['better-sqlite3'];

/**
 * Get the Node.js ABI version from the module
 */
function getModuleABI(moduleName) {
    const bindingPath = join(rootDir, 'node_modules', moduleName, 'build', 'Release');
    if (!existsSync(bindingPath)) {
        return null;
    }
    
    try {
        // Try to require the module and catch the error
        const modulePath = join(rootDir, 'node_modules', moduleName);
        execSync(`node -e "require('${modulePath.replace(/\\/g, '/')}')"`, {
            stdio: 'pipe',
            encoding: 'utf-8'
        });
        return process.versions.modules; // Module loaded successfully
    } catch (error) {
        const match = error.message?.match(/NODE_MODULE_VERSION (\d+)/);
        if (match) {
            return match[1];
        }
        return null;
    }
}

/**
 * Check if native modules are compatible with current Node.js version
 */
function checkNativeModules() {
    const currentABI = process.versions.modules;
    const nodeVersion = process.version;
    const issues = [];

    console.log(`\n🔍 Checking native module compatibility...`);
    console.log(`   Node.js version: ${nodeVersion} (ABI ${currentABI})\n`);

    for (const moduleName of NATIVE_MODULES) {
        const modulePath = join(rootDir, 'node_modules', moduleName);
        
        if (!existsSync(modulePath)) {
            console.log(`   ⚠️  ${moduleName}: Not installed`);
            issues.push({ module: moduleName, type: 'missing' });
            continue;
        }

        try {
            // Try to load the module
            execSync(`node -e "require('${modulePath.replace(/\\/g, '/')}')"`, {
                stdio: 'pipe',
                encoding: 'utf-8',
                cwd: rootDir
            });
            console.log(`   ✅ ${moduleName}: Compatible`);
        } catch (error) {
            const errorMsg = error.stderr || error.message || '';
            
            if (errorMsg.includes('NODE_MODULE_VERSION')) {
                const match = errorMsg.match(/NODE_MODULE_VERSION (\d+).*NODE_MODULE_VERSION (\d+)/);
                const compiledFor = match ? match[1] : 'unknown';
                const required = match ? match[2] : currentABI;
                
                console.log(`   ❌ ${moduleName}: Version mismatch`);
                console.log(`      Compiled for ABI ${compiledFor}, but Node.js requires ABI ${required}`);
                issues.push({ module: moduleName, type: 'version_mismatch', compiledFor, required });
            } else {
                console.log(`   ❌ ${moduleName}: Load error`);
                issues.push({ module: moduleName, type: 'error', message: errorMsg });
            }
        }
    }

    return issues;
}

/**
 * Attempt to rebuild native modules
 */
function rebuildModules(modules) {
    console.log(`\n🔧 Attempting to rebuild native modules...\n`);
    
    for (const moduleName of modules) {
        console.log(`   Rebuilding ${moduleName}...`);
        try {
            execSync(`npm rebuild ${moduleName}`, {
                stdio: 'inherit',
                cwd: rootDir
            });
            console.log(`   ✅ ${moduleName} rebuilt successfully\n`);
        } catch (error) {
            console.error(`   ❌ Failed to rebuild ${moduleName}`);
            console.error(`      Try running: npm rebuild ${moduleName}`);
            console.error(`      Or: rm -rf node_modules && npm install\n`);
            return false;
        }
    }
    return true;
}

// Main execution
const issues = checkNativeModules();

if (issues.length > 0) {
    const versionMismatches = issues.filter(i => i.type === 'version_mismatch').map(i => i.module);
    
    if (versionMismatches.length > 0) {
        console.log(`\n⚠️  Native module version mismatch detected!`);
        console.log(`   This usually happens after updating Node.js.\n`);
        
        // Check if --fix flag is passed
        if (process.argv.includes('--fix')) {
            const success = rebuildModules(versionMismatches);
            process.exit(success ? 0 : 1);
        } else {
            console.log(`   To fix automatically, run:`);
            console.log(`   $ node server/check-native-modules.js --fix\n`);
            console.log(`   Or manually rebuild:`);
            console.log(`   $ npm rebuild better-sqlite3\n`);
            process.exit(1);
        }
    }
} else {
    console.log(`\n✅ All native modules are compatible!\n`);
}

