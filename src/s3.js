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
  PutObjectCommand,
  PutBucketNotificationConfigurationCommand
} = require('@aws-sdk/client-s3');

/**
 * Push an object to s3.
 * @param params AWS upload params
 * @returns {Promise}
 */
async function putS3Object(params) {
  const s3 = new S3Client(config.AWS.clientConfig);
  const s3Upload = new Upload({
    client: s3,
    params: params
  });

  const data = await s3Upload.done();
  config.logger.info('Successfully uploaded to s3://', params.Bucket + '/' + params.Key);
  return data;
}


/**
 * List the objects in the given bucket (up to 1000 items)
 * @param bucketName name of the bucket
 * @param continuationToken continue listing from this marker
 * @returns {Promise}
 */
async function listObjects(bucketName, continuationToken) {
  const s3 = new S3Client(config.AWS.clientConfig);
  let params = {
    Bucket: bucketName,
    ContinuationToken: continuationToken
  };
  return await s3.send(new ListObjectsV2Command(params));
}

/**
 * List versions for the given object (up to 1000 versions)
 * @param bucketName name of the bucket
 * @param key object key
 * @param keyMarker continue listing from this marker
 * @param versionIdMarker continue listing from this marker
 * @returns {Promise}
 */
async function listObjectVersions(bucketName, key, keyMarker, versionIdMarker) {
  const s3 = new S3Client(config.AWS.clientConfig);
  let params = {
    Bucket: bucketName,
    Prefix: key,
    MaxKeys: 1,
    KeyMarker: keyMarker,
    VersionIdMarker: versionIdMarker
  };
  return await s3.send(new ListObjectVersionsCommand(params));
}

/**
 * Delete the specified items
 * @param bucketName the name of the bucket
 * @param objectKeys listing of object keys to delete
 * @returns {Promise}
 */
async function deleteObjects(bucketName, objectKeys) {
  const s3 = new S3Client(config.AWS.clientConfig);
  let params = {
    Bucket: bucketName,
    Delete: { Objects: objectKeys }
  };
  return await s3.send(new DeleteObjectsCommand(params));
}

/**
 * Delete the specified versioned items
 * @param bucketName the name of the bucket
 * @param objectKeys listing of the object keys to delete
 * @returns {Promise}
 */
async function deleteVersionedObjects(bucketName, objectKeys) {
  let listAndDelete = async function (key, continuationToken) {
    const data = await listObjectVersions(
      bucketName,
      key.Key || key,
      continuationToken && continuationToken.NextKeyMarker,
      continuationToken && continuationToken.NextVersionIdMarker
    );

    if (data && data.Versions && data.Versions.length > 0) {
      let keys = data.Versions.map((version) => ({
        Key: version.Key,
        VersionId: version.VersionId
      }));

      await deleteObjects(bucketName, keys);
      if (data.NextKeyMarker) {
        await listAndDelete(key, {
          NextKeyMarker: data.NextKeyMarker,
          NextVersionIdMarker: data.NextVersionIdMarker
        });
      }
    }
  };

  await Promise.all(objectKeys.map((key) => listAndDelete(key)));
}


/**
 * Empty the specified bucket (including all versioned items)
 * @param bucketName the name of the bucket
 * @returns {Promise}
 */
async function emptyBucket(bucketName) {
  let versioningEnabled = false;
  const s3 = new S3Client(config.AWS.clientConfig);
  let params = {
    Bucket: bucketName
  };

  let listAndDelete = async function (continuationToken) {
    const data = await listObjects(bucketName, continuationToken);
    if (data && data.Contents && data.Contents.length > 0) {
      let keys = data.Contents.map((object) => ({ Key: object.Key }));
      if (versioningEnabled) {
        await deleteVersionedObjects(bucketName, keys);
      } else {
        await deleteObjects(bucketName, keys);
        if (data.NextContinuationToken) {
          await listAndDelete(data.NextContinuationToken);
        }
      }
    }
  };

  try {
    const data = await s3.send(new GetBucketVersioningCommand(params));
    versioningEnabled = data.Status === 'Enabled';
    await listAndDelete();
  } catch (err) {
    if (err.toString().indexOf('The specified bucket does not exist') >= 0) {
      config.logger.info('Bucket', bucketName, 'does not exist, continuing...');
    } else {
      throw err;
    }
  }
}


/**
 * Upload a directory (including all subdirectories) to an S3 bucket.
 * @param bucketName the name of the bucket
 * @param prefix [optional] folder/prefix to upload content to
 * @param source fully qualified path of the source directory
 * @returns {Promise}
 */
async function uploadDirectory(bucketName, prefix, source) {
  if (!source) {
    source = prefix;
    prefix = null;
  }

  const s3 = new S3Client(config.AWS.clientConfig);

  const files = fs.readdirSync(source);
  if (!files || files.length === 0) {
    throw new Error(`Folder \'${source}\' is empty or does not exist. Did you forget to build your application?`);
  } else {
    let uploadFile = async function (name, filePath) {
      let key = (prefix ? prefix + '/' : '') + name;
      await s3.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: fs.createReadStream(filePath),
        ContentType: mime.lookup(name) || 'application/octet-stream'
      }));
      config.logger.info('Successfully uploaded to s3://', bucketName + '/' + key);
    };

    const operations = [];
    for (const fileName of files) {
      const filePath = path.join(source, fileName);
      if (fs.lstatSync(filePath).isDirectory()) {
        operations.push(uploadDirectory(bucketName, (prefix ? `${prefix}/` : '') + fileName, filePath));
      } else {
        operations.push(uploadFile(fileName, filePath));
      }
    }

    await Promise.all(operations);
  }
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
async function uploadDirectoryAsZipFile(bucketName, key, source, dest, name) {
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

  config.logger.info('Uploading ...');
  let stream = fs.createReadStream(fullPath);

  const uploadParams = await new Promise((resolve, reject) => {
    output.on('close', function () {
      config.logger.info('Zip archive written to ' + name + ' as ' + archive.pointer() + ' total bytes compressed');
      resolve({
        Bucket: bucketName,
        Key: key,
        Body: stream
      });
    });
  });

  const s3 = new S3Client(config.AWS.clientConfig);
  const s3Upload = new Upload({
    client: s3,
    params: uploadParams
  });
  s3Upload.on('httpUploadProgress', (progress, response) => {
    process.stdout.write('.');
  });
  await s3Upload.done();

  process.stdout.write('\n');
  config.logger.info('Successfully uploaded to s3://', bucketName + '/' + key);

  archive.pipe(output);
  archive.directory(source, '/');
  await archive.finalize();

  return fullPath;
}

/**
 * Add a notification configuration to the specified bucket
 * @param params AWS bucket notification configuration params
 * @returns {Promise}
 */
async function putBucketNotificationConfiguration(params) {
  const s3 = new S3Client(config.AWS.clientConfig);
  const res = await s3.send(new PutBucketNotificationConfigurationCommand(params));
  config.logger.info('Successfully added notification configuration to s3://', params.Bucket);
  return res
}


module.exports = {
  putS3Object,
  listObjects,
  listObjectVersions,
  deleteObjects,
  deleteVersionedObjects,
  emptyBucket,
  uploadDirectory,
  uploadDirectoryAsZipFile,
  putBucketNotificationConfiguration
};
