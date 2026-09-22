const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');

const APP_DIR = path.join(__dirname, '..', '..', 'app');
const APP_NATIVELIBS = path.join(APP_DIR, 'native', 'nativelibs')

const CLEAN_NATIVELIBS =[
    "db-cross-v4/prebuilt/darwin",
    "file-utilities/darwin",
    "file-utilities/darwin-arm",
    "file-utils/darwin",
    "file-utils/darwin-arm",
    "mp4thumb/darwin-arm64",
    "mp4thumb/darwin-x64",
    "sqlite3/binding/napi-v6-darwin-arm64",
    "sqlite3/binding/napi-v6-darwin-x64",
    "zimage/darwin_arm64",
    "zimage/darwin_x64",
    "zjxl/build/darwin_arm64",
    "zjxl/build/darwin_x64"
]

async function main() {
  logger.info('Cleaning unused nativelibs...');

  for(const dir of CLEAN_NATIVELIBS) {
    const dirPath = path.join(APP_NATIVELIBS, dir);
    try {
      await fs.access(dirPath);
      await fs.remove(dirPath);
      logger.dim('Cleaned', dirPath);
    } catch (e) {
      logger.warn('Could not find', dirPath);
    }
  }
}

module.exports = { main };