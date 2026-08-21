// Metro in an npm-workspaces monorepo (Plan §2.1 repo layout).
//
// Two things Metro does not work out on its own: it only watches the app
// directory, so edits in `packages/shared` would not trigger a reload; and it
// resolves modules relative to the app, so anything npm hoisted to the repo
// root would look missing. Both are pointed at explicitly below.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Prefer the app's own copy when a package exists in both, so React never
// gets loaded twice (the classic "invalid hook call" in a monorepo).
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
