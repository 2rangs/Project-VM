// electron-builder afterPack hook: ad-hoc sign the packaged macOS app.
// Changing the Electron bundle (new name, Info.plist, resources) invalidates the signature its
// binaries shipped with, and Apple Silicon will not run code without a valid one. An ad-hoc
// signature ("-") needs no certificate and is enough to launch on the machine that built it; it is
// NOT a distribution signature (no Developer ID, no notarisation).
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log(`  • ad-hoc signed   ${app}`);
};
