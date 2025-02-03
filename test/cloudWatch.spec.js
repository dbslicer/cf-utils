const _chai = require("chai");
const expect = _chai.expect;
_chai.use(require('chai-as-promised'));
const rewire = require("rewire");
const { mockClient } = require("aws-sdk-client-mock");
const { mockConfig } = require("./stubs");
const {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  DeleteLogGroupCommand
} = require("@aws-sdk/client-cloudwatch-logs");

// Rewire
const cloudWatch = rewire("../src/cloudWatch");

// CloudWatch Tests
describe("src/cloudWatch", () => {
  let stubs = [];

  // Mock CloudWatch Client
  let cwMock;

  beforeEach(() => {
    // Mock client
    cwMock = mockClient(CloudWatchLogsClient);
    // Mock config
    const configRestore = cloudWatch.__set__("config", mockConfig);
    stubs.push({ restore: function () { return configRestore(); } });
  });

  afterEach(() => {
    // Reset mock
    cwMock.reset();
    stubs.forEach(stub => stub.restore());
  });

  // List Log Groups
  it("lists log groups", async () => {
    const filter = "log-prefix";
    const expected = {
      logGroups: [{ logGroupName: "Log 1" }],
      nextToken: "continuation1"
    };

    cwMock.on(DescribeLogGroupsCommand).callsFake(input => {
      if (input.nextToken) {
        expect(input).to.eql({
          logGroupNamePrefix: filter,
          nextToken: expected.nextToken
        });
      } else {
        expect(input).to.eql({
          logGroupNamePrefix: filter,
          nextToken: undefined
        });
      }
      return expected;
    });

    // Without continuationToken
    await expect(cloudWatch.listLogGroups(filter)).to.eventually.deep.equal(expected);

    // With continuationToken
    return expect(cloudWatch.listLogGroups(filter, expected.nextToken)).to.eventually.deep.equal(expected);
  });

  // Delete Log Group
  it("deletes log group", async () => {
    const name = "log-group";

    cwMock.on(DeleteLogGroupCommand).callsFake(input => {
      expect(input).to.eql({ logGroupName: name });
      return {};
    });

    // Without continuationToken
    return expect(cloudWatch.deleteLogGroup(name)).to.eventually.deep.equal({});
  });

  // Delete Log Groups
  it("deletes log groups", async () => {
    const filter = "log-prefix";
    const expected_page1 = {
      logGroups: [{ logGroupName: `${filter}-group-1` }],
      nextToken: "continuation1"
    };
    const expected_page2 = {
      logGroups: [{ logGroupName: `${filter}-group-2` }]
    };

    // List is called so return the results
    cwMock.on(DescribeLogGroupsCommand).callsFake(input => {
      if (input.nextToken) {
        expect(input).to.eql({
          logGroupNamePrefix: filter,
          nextToken: expected_page1.nextToken
        });
        return expected_page2;
      }

      expect(input).to.eql({
        logGroupNamePrefix: filter,
        nextToken: undefined
      });
      return expected_page1;
    });
    cwMock.on(DeleteLogGroupCommand).callsFake(input => {
      expect(Object.keys(input)).to.have.members(["logGroupName"]);
      expect(input.logGroupName).to.be.oneOf([expected_page1.logGroups[0].logGroupName, expected_page2.logGroups[0].logGroupName]);
      return { deleted: true };
    });

    // Delete log groups
    return expect(cloudWatch.deleteLogGroups(filter)).to.eventually.be.fulfilled;
  });

});