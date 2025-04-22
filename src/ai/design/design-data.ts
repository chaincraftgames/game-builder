import fs from 'fs';
import path from 'path';

// Get the project root directory (where the Node.js process was started)
const projectRoot = process.cwd();
    
// Navigate to the constraints file location from project root
const constraintsPath = path.join(projectRoot, 'data/design/constraints.md');

// Export a function that reads the file each time it's called
export function getConstraintsRegistry(): string {
  // Read the file each time the function is called
  try {
    return fs.readFileSync(constraintsPath, 'utf-8');
  } catch (error) {
    console.error(`Error reading constraints file: ${error}`);
    return ""; // Return empty string if file can't be read
  }
}

// Keep the original export for backward compatibility
export const constraintsRegistry = getConstraintsRegistry();