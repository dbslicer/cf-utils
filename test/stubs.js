const { PassThrough, EventEmitter } = require("stream");
const path = require("path");

/**
 * Mock Config for cf-utils
 */
const mockConfig = {
  project: "test-project",
  projectVersion: "v1.0.0",
  AWS_PROFILE: "AWS_PROFILE",
  AWS_REGION: "AWS_REGION",
  awsRegion: "awsRegion",
  PROJECT_PREFIX: "project-prefix",
  logger: {
    info: (_) => { },
    warn: (_) => { },
  },
  AWS: {
    clientConfig: {}
  }
};

/**
 * 'fs' mock
 *
 * Use 'NO_FILES_DIR', 'ONLY_FILES_DIR', 'MIX_FILES_DIR' when reading
 * a directory for different result sets.
 *
 * 'functions' contains the mock 'fs.*()' functions
 */
const mockFs = {
  /**
   * Mock empty directory path
   */
  NO_FILES_DIR: "no/files/dir",
  /**
   * Mock directory path containing only files
   * readdirSync() defaults to this
   */
  ONLY_FILES_DIR: "only/files/dir",
  /**
   * Mock directory path containing files and a directory
   */
  MIX_FILES_DIR: "mix/files/dir",
  /**
   * Mocked fs functions
   */
  functions: {
    readdirSync: (path) => {
      if (path === mockFs.NO_FILES_DIR) {
        // Return empty directory listing
        return [];
      } else if (path === mockFs.MIX_FILES_DIR) {
        // Return directory listing with files and directory
        return [
          "file_1",
          "file_2",
          "dir_1",
        ];
      }

      // Return files only directory listing
      return [
        "file_1",
        "file_2",
        "file_3",
      ];
    },
    createReadStream: (_filePath) => {
      const pt = new PassThrough();
      pt.write("x".repeat(6 * 1024 * 1024));
      pt.end();
      return pt;
    },
    createWriteStream: (_path) => {
      const pt = new PassThrough()
      setTimeout(() => {
        pt.emit("close");
      }, 1);
      return pt;
    },
    lstatSync: (filePath) => {
      return {
        isDirectory: () => {
          return path.basename(filePath).startsWith("dir");
        }
      };
    },
    existsSync: (path) => { return !path.includes("DoesNotExist"); },
    mkdirSync: (_path) => { },
    readFileSync: (path) => { return path.includes("Transform") ? "Transform: \"AWS::Serverless\"" : path },
  }
};

/**
 * Mock S3 module
 */
const mockS3 = {
  putS3Object: async (_input) => { return {}; },
  emptyBucket: async (_input) => { return {}; },
  deleteObjects: async (_bucketName, objectKeys) => {
    return {
      Deleted: objectKeys.map(key => {
        return {
          DeleteMarker: "true",
          DeleteMarkerVersionId: key.VersionId,
          Key: key.Key
        }
      })
    };
  },
};

/**
 * Mock spawn module
 * @param {function} callback Callback for spawn events (event, args)
 * @returns mockSpawn object  with spawn function
 */
const mockSpawn = function (callback) {
  return {
    spawn: (command, args, options) => {
      callback("constructor", [command, args, options]);
      return {
        stdout: {
          on: (event, func) => { callback(`stdout.on.${event}`, [func]) },
          setEncoding: (encoding) => { callback("stdout.encoding", [encoding]) },
        },
        stderr: {
          on: (event, func) => { callback(`stderr.on.${event}`, [func]) },
          setEncoding: (encoding) => { callback("stderr.encoding", [encoding]) },
        },
        on: (event, func) => { callback(`on.${event}`, [func]) }
      };
    }
  };
};


module.exports = {
  mockConfig,
  mockFs,
  mockS3,
  mockSpawn,
};