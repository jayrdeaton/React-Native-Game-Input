// Two entries: the pure root barrel (src/index.ts) and the ./tilt subpath's React hook
// (src/tilt/index.ts, built to dist/tilt/index.*), kept apart so the root never loads react or
// react-native. See package.json's "exports" and CLAUDE.md's "The tilt subpath".
module.exports = require('@infinitetoken/tsconfig/tsup/lib')(['src/index.ts', 'src/tilt/index.ts'])
