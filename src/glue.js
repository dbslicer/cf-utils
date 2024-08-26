'use strict';
const config = require('./config');
const {
  GlueClient,
  GetTableCommand,
  BatchCreatePartitionCommand
} = require('@aws-sdk/client-glue');

/**
 * Create a series of label/year/month/day/hour partitions
 * @param {String} database database name
 * @param {String} table table name
 * @param {String} label partition label
 * @param {Date} start start date
 * @param {Number} days number of days to create partitions
 * @param {String} format partition format (Hive or default firehose format)
 * @param {String} catalogId [optional] catalog id
 */
async function createPartitions(database, table, label, start, days, format, catalogId) {
  let add = (d, c) => { let n = new Date(d); n.setDate(n.getDate() + c); return n; }
  let pad = (n) => n.toString().padStart(2, '0');
  let cut = (a, l) => { var c = [], i = 0, n = a.length; while (i < n) { c.push(a.slice(i, i += l)); } return c; }

  const glue = new GlueClient(config.AWS.clientConfig);
  let now = new Date();
  start = start > now ? now : start;
  let end = add(start, days);

  const info = await glue.send(new GetTableCommand({ DatabaseName: database, Name: table, CatalogId: catalogId }));
  let partitions = [];
  for (var date_1 = start; date_1 <= end; date_1 = new Date(date_1.getTime() + 36e5)) {
    let year = date_1.getFullYear().toString(),
      month = pad(date_1.getMonth() + 1),
      day = pad(date_1.getDate()),
      hour = pad(date_1.getHours());
    partitions.push({
      Values: [label, year, month, day, hour],
      StorageDescriptor: {
        Location: (format === 'Hive')
          ? info.Table.StorageDescriptor.Location + '/tenant=' + label + '/' + 'year=' + year + '/' + 'month=' + month + '/' + 'day=' + day + '/' + 'hour=' + hour + '/'
          : info.Table.StorageDescriptor.Location + label + '/' + year + '/' + month + '/' + day + '/' + hour,
        InputFormat: info.Table.StorageDescriptor.InputFormat,
        OutputFormat: info.Table.StorageDescriptor.OutputFormat,
        SerdeInfo: info.Table.StorageDescriptor.SerdeInfo,
        Parameters: info.Table.StorageDescriptor.Parameters,
        Columns: info.Table.StorageDescriptor.Columns
      }
    });
  }

  return await Promise.all(cut(partitions, 100).map(async list => {
    const result_6 = await glue.send(new BatchCreatePartitionCommand({
      CatalogId: catalogId, DatabaseName: database, TableName: table, PartitionInputList: list
    }));
    const err = (result_6.Errors || [])
      .find(e => e && e.ErrorDetail && e.ErrorDetail.ErrorCode && e.ErrorDetail.ErrorCode !== 'AlreadyExistsException');
    return await (err ? Promise.reject(err) : Promise.resolve(result_6));
  }));
}


module.exports = {
  createPartitions
};
