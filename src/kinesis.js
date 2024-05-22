'use strict';
const config = require('./config');
const {
  FirehoseClient,
  DescribeDeliveryStreamCommand,
  UpdateDestinationCommand,
  TagDeliveryStreamCommand
} = require('@aws-sdk/client-firehose');
const {
  KinesisAnalyticsClient,
  DescribeApplicationCommand,
  StartApplicationCommand
} = require('@aws-sdk/client-kinesis-analytics');

/**
 * Create a parquet conversion step for the specified firehose stream
 * @param {String} deliveryStreamName firehose delivery stream
 * @param {*} databaseName glue database name
 * @param {*} tableName table to store conversion output
 */
function createParquetConversion(deliveryStreamName, databaseName, tableName) {
  const firehose = new FirehoseClient(config.AWS.clientConfig);
  return firehose.send(new DescribeDeliveryStreamCommand({ DeliveryStreamName: deliveryStreamName }))
    .then(stream => {
      let s3dest = stream.DeliveryStreamDescription.Destinations[0]['ExtendedS3DestinationDescription'];

      s3dest.DataFormatConversionConfiguration = {
        SchemaConfiguration: {
          RoleARN: "",
          DatabaseName: databaseName,
          TableName: tableName,
          Region: config.awsRegion,
          VersionId: "LATEST"
        },
        InputFormatConfiguration: { Deserializer: { OpenXJsonSerDe: {} } },
        OutputFormatConfiguration: { Serializer: { ParquetSerDe: {} } },
        Enabled: true
      };
      s3dest.DataFormatConversionConfiguration.SchemaConfiguration.RoleARN = s3dest.RoleARN;
      s3dest.CompressionFormat = "UNCOMPRESSED";
      s3dest.BufferingHints = { SizeInMBs: 64, IntervalInSeconds: 60 };

      const params = {
        ExtendedS3DestinationUpdate: s3dest,
        CurrentDeliveryStreamVersionId: stream.DeliveryStreamDescription.VersionId,
        DestinationId: stream.DeliveryStreamDescription.Destinations[0].DestinationId,
        DeliveryStreamName: stream.DeliveryStreamDescription.DeliveryStreamName
      };
      config.logger.info("Updating firehose with parquet conversion:", params.DeliveryStreamName);
      return firehose.send(new UpdateDestinationCommand(params));
    });
}

/**
 * Tag the specified firehose stream
 * @param {String} firehose kinesis firehose stream
 */
function tagFirehoseStream(firehose, tags) {
  const fh = new FirehoseClient(config.AWS.clientConfig);
  let defaultTags = [
    {
      Key: 'acs:project',
      Value: config.project
    },
    {
      Key: 'acs:project-version',
      Value: config.projectVersion
    }
  ];
  return fh.send(new TagDeliveryStreamCommand({ DeliveryStreamName: firehose, Tags: tags ? tags : defaultTags }));
}

/**
 * Launch the specified kinesis application.
 * @param {String} application kinesis application
 */
function startApplication(application) {
  const kinesis = new KinesisAnalyticsClient(config.AWS.clientConfig);
  return kinesis.send(new DescribeApplicationCommand({ ApplicationName: application }))
    .then(appInfo => {
      config.logger.info('Starting kinesis application:', application, '...');
      return kinesis.send(new StartApplicationCommand({
        ApplicationName: application,
        InputConfigurations: [{
          Id: appInfo.InputDescriptions[0].Id,
          InputStartingPositionConfiguration: { InputStartingPosition: 'NOW' }
        }]
      }));
    });
}


module.exports = {
  createParquetConversion,
  tagFirehoseStream,
  startApplication
};
