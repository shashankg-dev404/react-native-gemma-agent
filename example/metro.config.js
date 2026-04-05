const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const projectRoot = __dirname;
const sdkRoot = path.resolve(projectRoot, '..');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [sdkRoot],
  resolver: {
    nodeModulesPaths: [path.resolve(projectRoot, 'node_modules')],
    blockList: [
      // Exclude SDK root's node_modules — metro must only use the example app's
      new RegExp(
        path.resolve(sdkRoot, 'node_modules').replace(/[/\\]/g, '[/\\\\]') +
          '/.*',
      ),
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
