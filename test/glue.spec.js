const _chai = require("chai");
const expect = _chai.expect;
_chai.use(require('chai-as-promised'));
const rewire = require("rewire");
const { mockClient } = require("aws-sdk-client-mock");
const { mockConfig } = require("./stubs");
const {
  GlueClient,
  GetTableCommand,
  BatchCreatePartitionCommand
} = require('@aws-sdk/client-glue');

// Rewire
const glue = rewire("../src/glue");

// glue Tests
describe("src/glue", () => {
  let stubs = [];

  // Mock Glue Client
  let glueMock;

  beforeEach(() => {
    // Mock client
    glueMock = mockClient(GlueClient);
    // Mock config
    const configRestore = glue.__set__("config", mockConfig);
    stubs.push({ restore: function () { return configRestore(); } });
  });

  afterEach(() => {
    // Reset mock
    glueMock.reset();
    stubs.forEach(stub => stub.restore());
  });

  // Create Partitions -Success
  it("creates partitions - success", async () => {
    const database = "glue-db";
    const table = "glue-table";
    const label = "data-label";
    const start = new Date("2024-01-25T17:01:00");
    const days = 2;
    const format = "Hive";
    const catalogId = "catalog1"

    // assert and resolve GetTableCommand
    glueMock.on(GetTableCommand).callsFake(input => {
      // assert
      expect(input).to.eql({ DatabaseName: database, Name: table, CatalogId: catalogId });

      // resolve
      return {
        Table: {
          StorageDescriptor: {
            Location: "storage-location",
            InputFormat: "input-format",
            OutputFormat: "output-format",
            SerdeInfo: {},
            Parameters: "parameter-map",
            Columns: [{ Name: "col-1" }, { Name: "col-2" }],
          }
        }
      };
    });

    // assert and resolve BatchCreatePartitionCommand
    glueMock.on(BatchCreatePartitionCommand).callsFake(input => {
      expect(Object.keys(input)).to.have.members(["CatalogId", "DatabaseName", "TableName", "PartitionInputList"]);
      expect(input.CatalogId).to.eql(catalogId);
      expect(input.DatabaseName).to.eql(database);
      expect(input.TableName).to.eql(table);

      expect(input.PartitionInputList).to.have.lengthOf(49);
      expect(Object.keys(input.PartitionInputList[0])).to.have.members(["Values", "StorageDescriptor"]);
      expect(Object.keys(input.PartitionInputList[0].StorageDescriptor)).to.have.members(["Location", "InputFormat", "OutputFormat", "SerdeInfo", "Parameters", "Columns"]);

      // resolve
      return { Errors: [] };
    });

    return expect(glue.createPartitions(database, table, label, start, days, format, catalogId)).to.eventually.deep.equal([{ Errors: [] }]);
  });

  // Create Partitions - success with errors
  it("creates partitions - success with errors", async () => {
    const database = "glue-db";
    const table = "glue-table";
    const label = "data-label";
    const start = new Date("2024-01-25T17:01:00");
    const days = 2;
    const format = "Hive";
    const catalogId = "catalog1"

    // assert and resolve GetTableCommand
    glueMock.on(GetTableCommand).callsFake(input => {
      // assert
      expect(input).to.eql({ DatabaseName: database, Name: table, CatalogId: catalogId });

      // resolve
      return {
        Table: {
          StorageDescriptor: {
            Location: "storage-location",
            InputFormat: "input-format",
            OutputFormat: "output-format",
            SerdeInfo: {},
            Parameters: "parameter-map",
            Columns: [{ Name: "col-1" }, { Name: "col-2" },],
          }
        }
      };
    });

    // assert and resolve BatchCreatePartitionCommand
    glueMock.on(BatchCreatePartitionCommand).callsFake(_input => {
      // resolve
      return { Errors: [{ ErrorDetail: { ErrorCode: "AlreadyExistsException", }, }] };
    });

    return expect(glue.createPartitions(database, table, label, start, days, format, catalogId)).to.eventually.deep.equal([
      { Errors: [{ ErrorDetail: { ErrorCode: "AlreadyExistsException", }, }] }
    ]);
  });

  // Create Partitions - failure
  it("failed to create partitions", async () => {
    const database = "glue-db";
    const table = "glue-table";
    const label = "data-label";
    const start = new Date("2024-01-25T17:01:00");
    const days = 2;
    const format = "Hive";
    const catalogId = "catalog1"

    // assert and resolve GetTableCommand
    glueMock.on(GetTableCommand).callsFake(input => {
      // assert
      expect(input).to.eql({ DatabaseName: database, Name: table, CatalogId: catalogId });

      // resolve
      return {
        Table: {
          StorageDescriptor: {
            Location: "storage-location",
            InputFormat: "input-format",
            OutputFormat: "output-format",
            SerdeInfo: {},
            Parameters: "parameter-map",
            Columns: [{ Name: "col-1" }, { Name: "col-2" }],
          }
        }
      };
    });

    // assert and resolve BatchCreatePartitionCommand
    glueMock.on(BatchCreatePartitionCommand).callsFake(_input => {
      return { Errors: [{ ErrorDetail: { ErrorCode: "SomeOtherGlueError" } }] };
    });

    try {
      await glue.createPartitions(database, table, label, start, days, format, catalogId);
    } catch (err) {
      expect(err).to.eql({ ErrorDetail: { ErrorCode: "SomeOtherGlueError" } });
    }
  });

});