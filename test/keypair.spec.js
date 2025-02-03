const _chai = require("chai");
const expect = _chai.expect;
_chai.use(require('chai-as-promised'));
const rewire = require("rewire");
const { mockClient } = require("aws-sdk-client-mock");
const { mockConfig, mockS3 } = require("./stubs");
const {
  EC2Client,
  CreateKeyPairCommand,
  DeleteKeyPairCommand
} = require('@aws-sdk/client-ec2');

// Rewire
const keypair = rewire("../src/keypair");

// keypair Tests
describe("src/keypair", () => {
  let stubs = [];

  // Mock keypair Client
  let keypairMock;

  beforeEach(() => {
    // Mock client
    keypairMock = mockClient(EC2Client);
    // Mock config
    const configRestore = keypair.__set__("config", mockConfig);
    stubs.push({ restore: function () { return configRestore(); } });

    // Mock S3
    const s3Restore = keypair.__set__("s3", mockS3);
    stubs.push({ restore: function () { return s3Restore(); } });
  });

  afterEach(() => {
    // Reset mock
    keypairMock.reset();
    stubs.forEach(stub => stub.restore());
  });

  describe("create keypair", () => {

    // createKeyPair
    it("creates keypair", async () => {
      const name = "my-keypair";

      // assert and resolve GetTableCommand
      keypairMock.on(CreateKeyPairCommand).callsFake(input => {
        // assert
        expect(input).to.eql({ KeyName: name });

        // resolve
        return {
          KeyName: name,
          KeyMaterial: "key-material"
        };
      });

      // Create key pair without saving to S3
      return expect(keypair.createKeyPair(name)).to.eventually.deep.equal({
        KeyName: name,
        KeyMaterial: "key-material"
      });
    });

    // createKeyPair
    it("creates keypair and saves to S3", async () => {
      const name = "my-keypair";
      const bucketName = "my-s3-bucket";
      const key = "bucket-key";

      // assert and resolve CreateKeyPairCommand
      keypairMock.on(CreateKeyPairCommand).callsFake(input => {
        // assert
        expect(input).to.eql({ KeyName: name });

        // resolve
        return {
          KeyName: name,
          KeyMaterial: "key-material"
        };
      });

      // Create key pair and save to S3
      return expect(keypair.createKeyPair(name, bucketName, key)).to.eventually.deep.equal({});
    });
  });

  // deleteKeyPair
  describe("delete keypair", () => {

    it("deletes keypair", async () => {
      const name = "my-keypair";

      // assert and resolve DeleteKeyPairCommand
      keypairMock.on(DeleteKeyPairCommand).callsFake(input => {
        // assert
        expect(input).to.eql({ KeyName: name });

        // resolve
        return {
          Return: true,
          KeyPairId: name,
        };
      });

      // Create key pair without saving to S3
      return expect(keypair.deleteKeyPair(name)).to.eventually.deep.equal({
        Return: true,
        KeyPairId: name,
      });
    });

    it("deletes keypair and deletes from S3", async () => {
      const name = "my-keypair";
      const bucketName = "my-s3-bucket";
      const key = "bucket-key";

      // assert and resolve DeleteKeyPairCommand
      keypairMock.on(DeleteKeyPairCommand).callsFake(input => {
        // assert
        expect(input).to.eql({ KeyName: name });

        // resolve
        return {
          Return: true,
          KeyPairId: name,
        };
      });

      // Create key pair without saving to S3
      return expect(keypair.deleteKeyPair(name, bucketName, key)).to.eventually.deep.equal({
        Deleted: [{
          DeleteMarker: true,
          DeleteMarkerVersionId: undefined,
          Key: key
        }]
      });
    });
  });

});