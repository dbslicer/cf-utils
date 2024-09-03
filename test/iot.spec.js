const _chai = require("chai");
const expect = _chai.expect;
_chai.use(require('chai-as-promised'));
const rewire = require("rewire");
const { mockClient } = require("aws-sdk-client-mock");
const { mockConfig } = require("./stubs");
const {
  IoTClient,
  GetPolicyCommand,
  CreatePolicyVersionCommand,
  ListPolicyVersionsCommand,
  DeletePolicyVersionCommand
} = require('@aws-sdk/client-iot');

// Rewire
const iot = rewire("../src/iot");

// iot Tests
describe("src/iot", () => {
  let stubs = [];

  // Mock iot Client
  let iotMock;

  beforeEach(() => {
    // Mock client
    iotMock = mockClient(IoTClient);
    // Mock config
    const configRestore = iot.__set__("config", mockConfig);
    stubs.push({ restore: function () { return configRestore(); } });
  });

  afterEach(() => {
    // Reset mock
    iotMock.reset();
    stubs.forEach(stub => stub.restore());
  });

  // updateIoTPolicies
  it("updates IoT policies", async () => {
    const stackOutput = {
      FirstIoTPolicyTemplate: "FirstIoTPolicyTemplate",
      FirstIoTPolicy: "FirstIoTPolicy",
      SecondIoTPolicyTemplate: "SecondIoTPolicyTemplate",
      SecondIoTPolicy: "SecondIoTPolicy",
      UnrelatedOutputResource: "UnrelatedOutputResource",
    };

    // Mock GetPolicyCommand
    iotMock.on(GetPolicyCommand).callsFake(input => {
      expect(Object.keys(input)).to.have.members(["policyName"]);
      expect(input.policyName).to.not.equal("UnrelatedOutputResource");

      return {
        policyName: input.policyName,
        policyArn: `arn:${input.policyName}`,
        policyDocument: "{}",
      };
    });
    // Mock CreatePolicyVersionCommand
    iotMock.on(CreatePolicyVersionCommand).callsFake(input => {
      expect(Object.keys(input)).to.have.members(["policyName", "policyDocument", "setAsDefault"]);
      expect(input.policyName.includes("IoTPolicy")).to.be.true;
      expect(input.policyName.includes("Template")).to.be.false;
      expect(input.policyDocument).to.eql("{}");
      expect(input.setAsDefault).to.be.true;

      return {
        policyArn: `arn:${input.policyName}`,
        policyDocument: "{}",
      };
    });
    // Mock ListPolicyVersionsCommand
    iotMock.on(ListPolicyVersionsCommand).callsFake(input => {
      expect(Object.keys(input)).to.have.members(["policyName"]);
      expect(input.policyName.includes("IoTPolicy")).to.be.true;
      expect(input.policyName.includes("Template")).to.be.false;
      return {
        policyVersions: [
          {
            versionId: "1",
            isDefaultVersion: true,
          },
          {
            versionId: "2",
            isDefaultVersion: false,
          },
          {
            versionId: "3",
            isDefaultVersion: false,
          },
        ],
      };
    });
    // Mock DeletePolicyVersionCommand
    iotMock.on(DeletePolicyVersionCommand).callsFake(input => {
      expect(Object.keys(input)).to.have.members(["policyName", "policyVersionId"]);
      expect(input.policyArn).to.not.be.null;
      expect(input.policyVersionId).to.not.be.null;
      return {};
    });

    const result = await iot.updateIoTPolicies(stackOutput);
    expect(result).to.have.lengthOf(2);
    expect(Object.keys(result[0])).to.have.members(["policyArn", "policyDocument"]);
  });

});