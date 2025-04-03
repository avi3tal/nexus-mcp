import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createRequire } from 'module';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Add support for require in ES modules
global.require = require;
global.__filename = __filename;
global.__dirname = __dirname;

// Register ts-node to handle TypeScript files
register('ts-node/esm', pathToFileURL('./')); 