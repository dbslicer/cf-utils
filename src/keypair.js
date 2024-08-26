'use strict';
const config = require('./config');
const s3 = require('./s3');
const {
  EC2Client,
  CreateKeyPairCommand,
  DeleteKeyPairCommand
} = require('@aws-sdk/client-ec2');

/**
 * Create a new key pair
 * @param name the name of the key pair
 * @param bucketName [optional] bucket to store keypair pem
 * @param key [optional] s3 target key for keypair pem
 * @return {Promise}
 */
async function createKeyPair(name, bucketName, key) {
  const ec2 = new EC2Client(config.AWS.clientConfig);

  try {
    const data = await ec2.send(new CreateKeyPairCommand({ KeyName: name }));
    config.logger.info('Successfully created new key pair: ' + name);
    if (bucketName) {
      return await s3.putS3Object({ Bucket: bucketName, Key: key, Body: data.KeyMaterial });
    }

    return data;
  } catch (err) {
    if (err.toString().indexOf('already exists') >= 0) {
      config.logger.info('Key pair already exists, continuing...');
      return;
    }

    throw err;
  }
}

/**
 * Delete the specified keypair
 * @param name the name of the key pair
 * @param bucketName [optional] bucket to delete keypair pem
 * @param key [optional] s3 target key for keypair pem
 * @return {Promise}
 */
async function deleteKeyPair(name, bucketName, key) {
  const ec2 = new EC2Client(config.AWS.clientConfig);
  const data = await ec2.send(new DeleteKeyPairCommand({ KeyName: name }));
  config.logger.info('Successfully deleted key pair : ' + name);

  if (bucketName) {
    config.logger.info('Deleting pem file s3://:' + bucketName + '/' + key);
    return await s3.deleteObjects(bucketName, [{ Key: key }]);
  }

  return data;
}

module.exports = {
  createKeyPair,
  deleteKeyPair
};
