import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the launcher tells the specs which throwaway data folder this session uses. */
export const SESSION_DIR_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '.driver',
  'session-dir.txt',
);
