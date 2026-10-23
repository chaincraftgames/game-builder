// ---------------------------------------------------------------------------
// Custom Jest resolver — disambiguates #chaincraft/* imports.
//
// game-builder's own source uses #chaincraft/* (resolved to src/).
// @chaincraft/runtime's dist also uses #chaincraft/* (resolved to its dist/).
// Jest's moduleNameMapper can't distinguish by importer location, so we use
// a custom resolver that checks options.basedir.
// ---------------------------------------------------------------------------

const path = require('path');

const ROOT = __dirname;
const RUNTIME_DIST = path.resolve(ROOT, '../chaincraft-runtime/dist');
const GAMEDEF_DIST = path.resolve(ROOT, '../gamedef/dist');

module.exports = (request, options) => {
  // #chaincraft/* — context-sensitive
  if (request.startsWith('#chaincraft/')) {
    const subpath = request.replace('#chaincraft/', '').replace(/\.js$/, '');

    // If the importer is inside chaincraft-runtime, resolve to the runtime's dist/
    if (options.basedir && options.basedir.includes('chaincraft-runtime')) {
      return path.join(RUNTIME_DIST, subpath + '.js');
    }

    // Otherwise it's game-builder's own import — resolve to src/
    return path.join(ROOT, 'src', subpath + '.ts');
  }

  // #gamedef/* — always resolve to gamedef dist
  if (request.startsWith('#gamedef/')) {
    const subpath = request.replace('#gamedef/', '').replace(/\.js$/, '');
    return path.join(GAMEDEF_DIST, subpath + '.js');
  }

  // Everything else — default resolution
  return options.defaultResolver(request, options);
};
