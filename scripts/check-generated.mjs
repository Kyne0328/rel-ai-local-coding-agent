import { verifyGeneratedAssets } from './dashboard-css.mjs';

try {
  verifyGeneratedAssets();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
