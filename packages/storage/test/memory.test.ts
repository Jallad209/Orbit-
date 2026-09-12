import { createMemoryRepository } from '../src/memory';
import { repositoryContract } from './contract';

repositoryContract('memory', {
  open: async (clock) => createMemoryRepository({ clock }),
});
