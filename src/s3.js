'use strict';
const config = require('./config');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const mime = require('mime-types');
const { Upload } = require('@aws-sdk/lib-storage');
const {
  S3Client,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
  GetBucketVersioningCommand,
  PutObjectCommand
} = require('@aws-sdk/client-s3');

/**
 * Push an object to s3.
 * @param params AWS upload params
 * @returns {Promise}
 */
async function putS3Object(params) {
  const s3 = new S3Client(config.AWS.clientConfig);
  const data = await new Upload({
    client: s3,
    params: params
  }).done();
  config.logger.info('Successfully uploaded to s3://', params.Bucket + '/' + params.Key);
  return data;
}


/**
 * List the objects in the given bucket (up to 1000 items)
 * @param bucketName name of the bucket
 * @param continuationToken continue listing from this marker
 * @returns {Promise}
 */
function listObjects(bucketName, continuationToken) {
  return new Promise((resolve, reject) => {
    const s3 = new S3Client(config.AWS.clientConfig);
    let params = {
      Bucket: bucketName,
      ContinuationToken: continuationToken
    };
    s3.send(new ListObjectsV2Command(params), (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

/**
 * List versions for the given object (up to 1000 versions)
 * @param bucketName name of the bucket
 * @param key object key
 * @param keyMarker continue listing from this marker
 * @param versionIdMarker continue listing from this marker
 * @returns {Promise}
 */
function listObjectVersions(bucketName, key, keyMarker, versionIdMarker) {
  return new Promise((resolve, reject) => {
    const s3 = new S3Client(config.AWS.clientConfig);
    let params = {
      Bucket: bucketName,
      Prefix: key,
      MaxKeys: 1,
      KeyMarker: keyMarker,
      VersionIdMarker: versionIdMarker
    };
    s3.send(new ListObjectVersionsCommand(params), (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

/**
 * Delete the specified items
 * @param bucketName the name of the bucket
 * @param objectKeys listing of object keys to delete
 * @returns {Promise}
 */
function deleteObjects(bucketName, objectKeys) {
  return new Promise((resolve, reject) => {
    const s3 = new S3Client(config.AWS.clientConfig);
    let params = {
      Bucket: bucketName,
      Delete: { Objects: objectKeys }
    };
    s3.send(new DeleteObjectsCommand(params), (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

/**
 * Delete the specified versioned items
 * @param bucketName the name of the bucket
 * @param objectKeys listing of the object keys to delete
 * @returns {Promise}
 */
function deleteVersionedObjects(bucketName, objectKeys) {
  return new Promise((resolve, reject) => {
    let listAndDelete = function (key, continuationToken) {
      return new Promise((resolve, reject) => {
        listObjectVersions(bucketName, key.Key || key,
          continuationToken && continuationToken.NextKeyMarker,
          continuationToken && continuationToken.NextVersionIdMarker)
          .then(data => {
            if (data && data.Versions && data.Versions.length > 0) {
              let keys = data.Versions.map((version) => ({ Key: version.Key, VersionId: version.VersionId }));
              deleteObjects(bucketName, keys)
                .then(() => data.NextKeyMarker ?
                  listAndDelete(key, {
                    NextKeyMarker: data.NextKeyMarker,
                    NextVersionIdMarker: data.NextVersionIdMarker
                  }) : resolve());
            } else {
              resolve();
            }
          }).catch(err => reject(err));
      });
    };

    Promise.all(objectKeys.map((key) => new Promise((resolve, reject) => {
      listAndDelete(key)
        .then(() => resolve())
        .catch(err => reject(err));
    })))
      .then(() => resolve())
      .catch(err => reject(err));
  });
}


/**
 * Empty the specified bucket (including all versioned items)
 * @param bucketName the name of the bucket
 * @returns {Promise}
 */
function emptyBucket(bucketName) {
  return new Promise((resolve, reject) => {
    let versioningEnabled = false;
    const s3 = new S3Client(config.AWS.clientConfig);
    let params = {
      Bucket: bucketName
    };

    let listAndDelete = function (continuationToken) {
      return new Promise((resolve, reject) => {
        listObjects(bucketName, continuationToken)
          .then(data => {
            if (data && data.Contents && data.Contents.length > 0) {
              let keys = data.Contents.map((object) => ({ Key: object.Key }));
              (versioningEnabled ?
                deleteVersionedObjects(bucketName, keys) :
                deleteObjects(bucketName, keys))
                .then(() => data.NextContinuationToken ?
                  listAndDelete(data.NextContinuationToken) : resolve());
            } else {
              resolve();
            }
          }).catch(err => reject(err));
      });
    };

    s3.send(new GetBucketVersioningCommand(params), (err, data) => {
      if (err) {
        if (err.toString().indexOf('The specified bucket does not exist') >= 0) {
          config.logger.info('Bucket', bucketName, 'does not exist, continuing...');
          resolve();
        } else {
          reject(err);
        }
      } else {
        versioningEnabled = data.Status === 'Enabled';

        listAndDelete()
          .then(() => resolve())
          .catch(err => reject(err));
      }
    });
  });
}


/**
 * Upload a directory (including all subdirectories) to an S3 bucket.
 * @param bucketName the name of the bucket
 * @param prefix [optional] folder/prefix to upload content to
 * @param source fully qualified path of the source directory
 * @returns {Promise}
 */
function uploadDirectory(bucketName, prefix, source) {
  if (!source) { source = prefix; prefix = null; }

  return new Promise((resolve, reject) => {
    const s3 = new S3Client(config.AWS.clientConfig);

    fs.readdir(source, (err, files) => {
      if (err) {
        reject(err);
      } else {
        if (!files || files.length === 0) {
          reject(new Error(`Folder \'${source}\' is empty or does not exist. Did you forget to build your application?`))
        } else {
          let uploadFile = function (name, filePath) {
            let key = (prefix ? prefix + '/' : '') + name;
            return new Promise((resolve, reject) => {
              s3.send(new PutObjectCommand({
                Bucket: bucketName,
                Key: key,
                Body: fs.createReadStream(filePath),
                ContentType: mime.lookup(name) || 'application/octet-stream'
              }), (err) => {
                if (err) {
                  reject(err);
                } else {
                  config.logger.info('Successfully uploaded to s3://', bucketName + '/' + key);
                  resolve();
                }
              });
            });
          };

          let operations = [];
          for (const fileName of files) {
            const filePath = path.join(source, fileName);
            if (fs.lstatSync(filePath).isDirectory()) {
              operations.push(uploadDirectory(bucketName, (prefix ? prefix + '/' : '') + fileName, filePath));
            } else {
              operations.push(uploadFile(fileName, filePath));
            }
          }

          Promise.all(operations)
            .then(() => resolve())
            .catch(err => reject(err));
        }
      }
    });
  });
}

/**
 * Upload the directory as a zip file to s3.
 * @param bucketName the name of the bucket
 * @param key s3 target key
 * @param source source directory
 * @param dest destination directory for zip file
 * @param name name of the zip file
 * @returns {Promise}
 */
function uploadDirectoryAsZipFile(bucketName, key, source, dest, name) {
  return new Promise((resolve, reject) => {

    // Create dest directory if it does not exist
    dest.split(dest.includes(path.sep) ? path.sep : '/').reduce((parent, child) => {
      const curr = path.resolve(parent, child);
      if (!fs.existsSync(curr)) {
        fs.mkdirSync(curr);
        config.logger.info("Created directory: " + curr);
      }
      return curr;
    }, path.isAbsolute(dest) ? path.sep : '');


    let fullPath = path.join(dest, name);
    let output = fs.createWriteStream(fullPath);
    let archive = archiver.create('zip');

    output.on('close', function () {
      config.logger.info('Zip archive written to ' + name + ' as ' + archive.pointer() + ' total bytes compressed');

      config.logger.info('Uploading ...');
      const s3 = new S3Client(config.AWS.clientConfig);
      let stream = fs.createReadStream(fullPath);
      s3.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: stream
      }), function (err) {
        if (err) {
          reject(err);
        } else {
          process.stdout.write('\n');
          config.logger.info('Successfully uploaded to s3://', bucketName + '/' + key);
          resolve(fullPath);
        }
      })
        .on('httpUploadProgress', (progress, response) => {
          process.stdout.write('.');
        });
    });

    archive.on('error', function (err) {
      reject(err);
    });

    archive.pipe(output);
    archive.directory(source, '/');
    archive.finalize();
  });
}



module.exports = {
  putS3Object,
  listObjects,
  listObjectVersions,
  deleteObjects,
  deleteVersionedObjects,
  emptyBucket,
  uploadDirectory,
  uploadDirectoryAsZipFile
};
