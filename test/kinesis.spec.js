const _chai = require("chai");
const expect = _chai.expect;
_chai.use(require('chai-as-promised'));
const rewire = require("rewire");
const { mockClient } = require("aws-sdk-client-mock");
const { mockConfig } = require("./stubs");
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

// Rewire
const kinesis = rewire("../src/kinesis");

// kinesis Tests
describe("src/kinesis", () => {
  let stubs = [];

  // Mock kinesis Client
  let kinesisMock;
  let kinesisAnalyticsMock;

  beforeEach(() => {
    // Mock client
    kinesisMock = mockClient(FirehoseClient);
    kinesisAnalyticsMock = mockClient(KinesisAnalyticsClient);
    // Mock config
    const configRestore = kinesis.__set__("config", mockConfig);
    stubs.push({ restore: function () { return configRestore(); } });
  });

  afterEach(() => {
    // Reset mock
    kinesisMock.reset();
    kinesisAnalyticsMock.reset();
    stubs.forEach(stub => stub.restore());
  });

  // createParquetConversion
  it("creates parquet conversion", async () => {
    const deliveryStreamName = "delivery-stream-1";
    const databaseName = "glue-bd";
    const tableName = "glue-table";
    const versionId = "stream-version-id";
    const destinationId = "dest-id";
    const streamName = "stream-name";
    const roleArn = "destination-role-arn";

    // assert and resolve DescribeDeliveryStreamCommand
    kinesisMock.on(DescribeDeliveryStreamCommand).callsFake(input => {
      // expect
      expect(input).to.eql({ DeliveryStreamName: deliveryStreamName });

      // resolve
      return {
        DeliveryStreamDescription: {
          VersionId: versionId,
          DeliveryStreamName: streamName,
          Destinations: [
            {
              DestinationId: destinationId,
              ExtendedS3DestinationDescription: { RoleARN: roleArn, }
            }
          ]
        }
      };
    });

    // assert and resolve UpdateDestinationCommand
    kinesisMock.on(UpdateDestinationCommand).callsFake(input => {
      // expect
      expect(Object.keys(input)).to.have.members(["ExtendedS3DestinationUpdate", "CurrentDeliveryStreamVersionId", "DestinationId", "DeliveryStreamName"]);
      expect(input.CurrentDeliveryStreamVersionId).to.eql(versionId);
      expect(input.DestinationId).to.eql(destinationId);
      expect(input.DeliveryStreamName).to.eql(streamName);

      expect(Object.keys(input.ExtendedS3DestinationUpdate)).to.have.members(["RoleARN", "DataFormatConversionConfiguration", "CompressionFormat", "BufferingHints"]);
      expect(input.ExtendedS3DestinationUpdate.RoleARN).to.eql(roleArn);
      expect(input.ExtendedS3DestinationUpdate.CompressionFormat).to.eql("UNCOMPRESSED");
      expect(input.ExtendedS3DestinationUpdate.BufferingHints).to.eql({ SizeInMBs: 64, IntervalInSeconds: 60 });

      expect(Object.keys(input.ExtendedS3DestinationUpdate.DataFormatConversionConfiguration)).to.have.members(["SchemaConfiguration", "InputFormatConfiguration", "OutputFormatConfiguration", "Enabled"]);
      expect(input.ExtendedS3DestinationUpdate.DataFormatConversionConfiguration.SchemaConfiguration).to.eql({
        RoleARN: roleArn,
        DatabaseName: databaseName,
        TableName: tableName,
        Region: mockConfig.awsRegion,
        VersionId: "LATEST"
      });
      expect(input.ExtendedS3DestinationUpdate.DataFormatConversionConfiguration.InputFormatConfiguration).to.eql({ Deserializer: { OpenXJsonSerDe: {} } });
      expect(input.ExtendedS3DestinationUpdate.DataFormatConversionConfiguration.OutputFormatConfiguration).to.eql({ Serializer: { ParquetSerDe: {} } });
      expect(input.ExtendedS3DestinationUpdate.DataFormatConversionConfiguration.Enabled).to.be.true;

      // resolve
      return {};
    });

    return expect(kinesis.createParquetConversion(deliveryStreamName, databaseName, tableName)).to.eventually.deep.equal({});
  });

  // tagFirehoseStream
  it("tags firehose stream", async () => {
    const firehose = "firehose-stream"
    const tags = [{ Key: 'test:project', Value: "test.project" }];

    kinesisMock.on(TagDeliveryStreamCommand).callsFake(input => {
      expect(Object.keys(input)).to.have.members(["DeliveryStreamName", "Tags"]);
      if (input.DeliveryStreamName.includes("tags")) {
        // expect our tags
        expect(input.DeliveryStreamName).to.eql(`${firehose}-tags`);
        expect(input.Tags).to.eql(tags);
      } else {
        // expect default tags
        expect(input.DeliveryStreamName).to.eql(firehose);
        expect(input.Tags).to.eql([
          { Key: 'acs:project', Value: mockConfig.project },
          { Key: 'acs:project-version', Value: mockConfig.projectVersion }
        ]);
      }
      return {};
    });

    await expect(kinesis.tagFirehoseStream(firehose)).to.eventually.deep.equal({});

    await expect(kinesis.tagFirehoseStream(`${firehose}-tags`, tags)).to.eventually.deep.equal({});
  });

  // startApplication
  it("starts application", async () => {
    const application = "my-application";
    const appId = "app12bcd9"

    kinesisAnalyticsMock
      .on(DescribeApplicationCommand).callsFake(input => {
        expect(input).to.eql({ ApplicationName: application });
        return { InputDescriptions: [{ Id: appId }] };
      })
      .on(StartApplicationCommand).callsFake(input => {
        expect(input).to.eql({
          ApplicationName: application,
          InputConfigurations: [{
            Id: appId,
            InputStartingPositionConfiguration: { InputStartingPosition: 'NOW' }
          }]
        });
        return {};
      });

    return expect(kinesis.startApplication(application)).to.eventually.deep.equal({});
  });

});