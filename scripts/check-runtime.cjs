const assert = require('node:assert/strict');

// Native SQLite/sharp packages require a supported 64-bit Node release.
// Keep this check dependency-free: it must work before pnpm install.
function checkRuntime(version, arch) {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  assert.ok((major === 22 && minor >= 12) || major === 24,
    `Node.js ${version} is unsupported. Install Node.js 22.12+ (22 LTS) or 24 LTS, then reopen the terminal.`);
  assert.equal(arch, 'x64',
    `Node.js architecture is ${arch}. Install the x64 Node.js build for Windows (also on Windows ARM via x64 emulation).`);
}

module.exports = {checkRuntime};

if (require.main === module) {
  try {
    checkRuntime(process.version, process.arch);
    console.log(`Node.js ${process.version} ${process.arch}: OK`);
    if (process.argv.includes('--native')) {
      const db = new (require('better-sqlite3'))(':memory:');
      assert.equal(db.prepare('select 1 as ok').get().ok, 1);
      db.close();
      require('sharp');
      console.log('SQLite and image native modules: OK');
    }
  } catch (error) {
    console.error(error.message);
    if (process.argv.includes('--native')) {
      console.error('Native module check failed. After changing Node.js, run pnpm rebuild better-sqlite3 sharp esbuild. See logs/startup.log.');
    }
    process.exitCode = 1;
  }
}
