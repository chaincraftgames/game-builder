import { simpleGit, SimpleGitOptions } from 'simple-git';
import path from 'path';

const options: Partial<SimpleGitOptions> = {
    baseDir: process.cwd(),
    binary: 'git',
    maxConcurrentProcesses: 6,
    trimmed: false,
 };
 
 // when setting all options in a single object
 const git = simpleGit(options);

export async function getFileCommitHash(filePath: string): Promise<string> {
  try {
    // Get the log for the specific file
    const log = await git.log({
      file: filePath,
      maxCount: 1
    });

    return log.latest?.hash || 'unknown';
  } catch (error) {
    // console.warn(`Failed to get commit hash for ${filePath}:`, error);
    return 'unknown';
  }
}