// ---------------------------------------------------------------------------
// Custom Jest resolver for @chaincraft/compiler
//
// Resolves #chaincraft/* (runtime internals), #compiler/* (own source),
// and #gamedef/* (gamedef internals) to the correct locations.
// ---------------------------------------------------------------------------

const path = require('path');

const ROOT = __dirname;
const RUNTIME_DIST = path.resolve(ROOT, '../chaincraft-runtime/dist');
const GAMEDEF_DIST = path.resolve(ROOT, '../gamedef/dist');

module.exports = (request, options) => {
  // #chaincraft/* — runtime internals (used by runtime's own dist code)
  if (request.startsWith('#chaincraft/')) {
    const subpath = request.replace('#chaincraft/', '').replace(/\.js$/, '');
    if (options.basedir && options.basedir.includes('chaincraft-runtime')) {
      return path.join(RUNTIME_DIST, subpath + '.js');
    }
    // Shouldn't happen in compiler source, but fall through to default
    return options.defaultResolver(request, options);
  }

  // #compiler/* — own source imports (for tests)
  if (request.startsWith('#compiler/')) {
    const subpath = request.replace('#compiler/', '').replace(/\.js$/, '');
    return path.join(ROOT, 'src', subpath + '.ts');
  }

  // #gamedef/* — gamedef internals
  if (request.startsWith('#gamedef/')) {
    const subpath = request.replace('#gamedef/', '').replace(/\.js$/, '');
    return path.join(GAMEDEF_DIST, subpath + '.js');
  }

  // Everything else — default resolution
  return options.defaultResolver(request, options);
};
